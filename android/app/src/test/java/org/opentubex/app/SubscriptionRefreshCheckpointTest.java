package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class SubscriptionRefreshCheckpointTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test
    public void interruptedPassesEventuallyReachEveryChannelWithoutRestartingAtTheFirst() throws Exception {
        File file = new File(temporary.newFolder(), "progress.properties");
        List<Integer> visited = new ArrayList<>();
        for (int batch = 0; batch < 9; batch++) {
            SubscriptionRefreshCheckpoint checkpoint = SubscriptionRefreshCheckpoint.load(file, "configuration", 900);
            int completed = checkpoint.completed;
            for (int index = checkpoint.nextIndex; index < (batch + 1) * 100; index++) {
                visited.add(index);
                checkpoint.save(index + 1, ++completed, 0, Set.of());
            }
            // Recreating the checkpoint above simulates process loss between batches.
        }
        assertEquals(900, visited.size());
        for (int index = 0; index < 900; index++) assertEquals(index, visited.get(index).intValue());
        SubscriptionRefreshCheckpoint completed = SubscriptionRefreshCheckpoint.load(file, "configuration", 900);
        assertEquals(900, completed.nextIndex);
        completed.clear();
        assertEquals(0, SubscriptionRefreshCheckpoint.load(file, "configuration", 900).nextIndex);
    }

    @Test
    public void failureStateSurvivesRestartsButChangedConfigurationStartsANewPass() throws Exception {
        File file = new File(temporary.newFolder(), "progress.properties");
        SubscriptionRefreshCheckpoint checkpoint = SubscriptionRefreshCheckpoint.load(file, "first", 10);
        checkpoint.save(3, 2, 1, Set.of("profile-with-failure"));
        SubscriptionRefreshCheckpoint resumed = SubscriptionRefreshCheckpoint.load(file, "first", 10);
        assertEquals(3, resumed.nextIndex);
        assertEquals(2, resumed.completed);
        assertEquals(1, resumed.failed);
        assertEquals(Set.of("profile-with-failure"), resumed.failedProfileIds);
        assertEquals(0, SubscriptionRefreshCheckpoint.load(file, "second", 10).nextIndex);
        assertEquals(0, SubscriptionRefreshCheckpoint.load(file, "first", 2).nextIndex);
    }

    @Test
    public void nullAuthorizationDiffersFromLiteralNull() {
        SubscriptionRefreshConfiguration.Feed anonymous = feed("https://first.test", List.of("one"));
        SubscriptionRefreshConfiguration.Feed authorized = new SubscriptionRefreshConfiguration.Feed(
            "profile", "videos", 900_000, List.of("one"), "https://first.test", "null", "Refresh", "Cancel"
        );
        assertNotEquals(
            SubscriptionRefreshCheckpoint.configurationId(List.of(anonymous)),
            SubscriptionRefreshCheckpoint.configurationId(List.of(authorized))
        );
    }

    @Test
    public void malformedPropertiesStartAFreshPassAndCanBeReplaced() throws Exception {
        File file = new File(temporary.newFolder(), "progress.properties");
        Files.write(file.toPath(), "bad=\\u12G4\n".getBytes(StandardCharsets.UTF_8));
        SubscriptionRefreshCheckpoint checkpoint = SubscriptionRefreshCheckpoint.load(file, "configuration", 10);
        assertEquals(0, checkpoint.nextIndex);
        checkpoint.save(1, 1, 0, Set.of());
        assertEquals(1, SubscriptionRefreshCheckpoint.load(file, "configuration", 10).nextIndex);
    }

    @Test
    public void changingProviderOrProfileMembershipInvalidatesProgress() {
        SubscriptionRefreshConfiguration.Feed first = feed("https://first.test", List.of("one", "two"));
        assertNotEquals(
            SubscriptionRefreshCheckpoint.configurationId(List.of(first)),
            SubscriptionRefreshCheckpoint.configurationId(List.of(feed("https://second.test", List.of("one", "two"))))
        );
        assertNotEquals(
            SubscriptionRefreshCheckpoint.configurationId(List.of(first)),
            SubscriptionRefreshCheckpoint.configurationId(List.of(feed("https://first.test", List.of("two", "one"))))
        );
    }

    private static SubscriptionRefreshConfiguration.Feed feed(String instance, List<String> channels) {
        return new SubscriptionRefreshConfiguration.Feed("profile", "videos", 900_000, channels, instance, null, "Refresh", "Cancel");
    }
}
