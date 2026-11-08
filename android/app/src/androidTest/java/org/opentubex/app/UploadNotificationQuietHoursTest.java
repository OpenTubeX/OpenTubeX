package org.opentubex.app;

import static org.junit.Assert.*;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.LocalTime;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class UploadNotificationQuietHoursTest {
    private Context context;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),
                android.Manifest.permission.POST_NOTIFICATIONS);
        }
        manager().cancelAll();
    }

    @After
    public void tearDown() {
        manager().cancelAll();
        UploadNotifications.configure(context, new JSONObject());
    }

    @Test
    public void uploadsDuringQuietHoursNotifySilently() throws Exception {
        int minute = LocalTime.now().getHour() * 60 + LocalTime.now().getMinute();
        // Covers the current minute and the next, so the test cannot cross the window's end.
        Notification notification = notifyAboutUpload(new JSONObject().put("start", minute).put("end", (minute + 2) % 1440));
        assertEquals("quiet-new-uploads", notification.getGroup());
        assertEquals(Notification.GROUP_ALERT_SUMMARY, notification.getGroupAlertBehavior());
    }

    @Test
    public void uploadsOutsideQuietHoursAlert() throws Exception {
        int minute = LocalTime.now().getHour() * 60 + LocalTime.now().getMinute();
        Notification notification = notifyAboutUpload(new JSONObject().put("start", (minute + 60) % 1440).put("end", (minute + 120) % 1440));
        assertNull(notification.getGroup());
        assertEquals(Notification.GROUP_ALERT_ALL, notification.getGroupAlertBehavior());
    }

    private Notification notifyAboutUpload(JSONObject quietHours) throws Exception {
        JSONObject channel = new JSONObject().put("name", "One").put("feedTypes", new JSONArray().put("videos"));
        UploadNotifications.configure(context, new JSONObject()
            .put("enabled", true)
            .put("titles", new JSONObject().put("videos", "New video from {channel}"))
            .put("channels", new JSONObject().put("UC1", channel))
            .put("quietHours", quietHours));
        long now = System.currentTimeMillis();
        UploadNotifications.observe(context, "UC1", "videos", new JSONArray().put(entry("a", now)));
        UploadNotifications.observe(context, "UC1", "videos", new JSONArray().put(entry("b", now)).put(entry("a", now)));

        Notification found = null;
        for (StatusBarNotification active : manager().getActiveNotifications()) {
            if (!"new-upload".equals(active.getTag())) continue;
            assertNull("only one upload is new", found);
            found = active.getNotification();
        }
        assertNotNull(found);
        return found;
    }

    private static JSONObject entry(String id, long published) throws Exception {
        return new JSONObject().put("id", id).put("title", "Title " + id).put("published", published);
    }

    private NotificationManager manager() {
        return context.getSystemService(NotificationManager.class);
    }
}
