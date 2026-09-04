package org.opentubex.app;

import static org.junit.Assert.assertEquals;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.junit.Test;

public class SubscriptionRefreshWorkerTargetsTest {
    @Test
    public void fetchedChannelsAreStoredForEverySubscribedProfile() {
        List<SubscriptionRefreshConfiguration.Feed> feeds = List.of(
            feed("first", List.of("shared", "first-only")),
            feed("second", List.of("shared", "second-only"))
        );

        assertEquals(
            List.of("first", "second"),
            SubscriptionRefreshWorker.targetProfileIds(feeds, "shared")
        );
        assertEquals(
            List.of("second"),
            SubscriptionRefreshWorker.targetProfileIds(feeds, "second-only")
        );
    }

    @Test
    public void failedProfilesAreSkippedAndCompletionFailuresDoNotSkipLaterProfiles() {
        List<SubscriptionRefreshConfiguration.Feed> feeds = List.of(
            feed("first", List.of("shared")),
            feed("second", List.of("shared")),
            feed("third", List.of("shared"))
        );
        List<String> attemptedProfileIds = new ArrayList<>();
        List<String> failedProfileIds = new ArrayList<>();

        SubscriptionRefreshWorker.writeProfileCompletions(
            feeds,
            Set.of("first"),
            profileFeed -> {
                attemptedProfileIds.add(profileFeed.profileId);
                if (profileFeed.profileId.equals("second")) {
                    throw new IOException("Result store unavailable");
                }
            },
            (profileFeed, error) -> failedProfileIds.add(profileFeed.profileId)
        );

        assertEquals(List.of("second", "third"), attemptedProfileIds);
        assertEquals(List.of("second"), failedProfileIds);
    }

    private static SubscriptionRefreshConfiguration.Feed feed(
        String profileId,
        List<String> channelIds
    ) {
        return new SubscriptionRefreshConfiguration.Feed(
            profileId,
            "videos",
            900_000,
            channelIds,
            "https://example.test",
            null,
            "Refreshing subscriptions",
            "Cancel"
        );
    }
}
