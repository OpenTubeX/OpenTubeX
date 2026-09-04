package org.opentubex.app;

import static org.junit.Assert.assertEquals;

import java.util.List;

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
