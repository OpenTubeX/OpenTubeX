package org.opentubex.app;

import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.text.SpannableString;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class AndroidSharePluginTest {
    private static class Receiver extends AndroidSharePlugin {
        int deliveries;
        JSObject shared;

        @Override
        protected void notifyListeners(String name, JSObject data, boolean retained) {
            assertEquals("sharedText", name);
            assertTrue("Cold-start shares must wait for the renderer listener", retained);
            deliveries++;
            shared = data;
        }
    }

    @Test public void appearsAsATextShareTarget() {
        android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Intent intent = new Intent(Intent.ACTION_SEND).setType("text/plain").setPackage(context.getPackageName());
        List<ResolveInfo> activities = context.getPackageManager().queryIntentActivities(intent, 0);
        assertTrue(activities.stream().anyMatch(info -> info.activityInfo.name.equals(MainActivity.class.getName())));
        assertTrue(context.getPackageManager().queryIntentActivities(intent.setType("image/png"), 0).isEmpty());
    }

    @Test public void consumesPlainAndStyledTextOnceButAcceptsRepeatedShares() {
        Receiver receiver = new Receiver();
        String text = "Video title\nhttps://youtu.be/abcdefghijk?t=42";
        Intent intent = new Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, new SpannableString(text));
        receiver.handleOnNewIntent(intent);
        assertEquals(text, receiver.shared.getString("text"));
        assertFalse(intent.hasExtra(Intent.EXTRA_TEXT));
        receiver.handleOnNewIntent(intent);
        assertEquals(1, receiver.deliveries);
        receiver.handleOnNewIntent(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text));
        assertEquals(2, receiver.deliveries);
    }

    @Test public void ignoresOtherIntentsAndDoesNotAlterViewLinks() {
        Receiver receiver = new Receiver();
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse("https://youtu.be/abcdefghijk"));
        receiver.handleOnNewIntent(view);
        receiver.handleOnNewIntent(new Intent(Intent.ACTION_SEND).setType("image/png"));
        receiver.handleOnNewIntent(new Intent(Intent.ACTION_SEND_MULTIPLE).setType("text/plain"));
        receiver.handleOnNewIntent(new Intent(Intent.ACTION_SEND).setType("text/plain"));
        assertEquals(0, receiver.deliveries);
        assertEquals("https://youtu.be/abcdefghijk", view.getData().toString());
    }
}
