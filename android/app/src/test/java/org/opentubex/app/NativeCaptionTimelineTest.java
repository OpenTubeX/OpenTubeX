package org.opentubex.app;

import static org.junit.Assert.*;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class NativeCaptionTimelineTest {
    @Test public void seekingSelectsOverlappingCuesAndClearsAtTheirEnd() {
        NativeCaptionTimeline.Entry first = new NativeCaptionTimeline.Entry(2000, 5000, "Hello");
        NativeCaptionTimeline.Entry second = new NativeCaptionTimeline.Entry(4000, 6000, "World");
        NativeCaptionTimeline timeline = new NativeCaptionTimeline(Arrays.asList(first, second));
        assertEquals(Collections.emptyList(), timeline.at(1999));
        assertEquals(Arrays.asList(first), timeline.at(2000));
        assertEquals(Arrays.asList(first, second), timeline.at(4000));
        assertEquals(Arrays.asList(second), timeline.at(5000));
        assertEquals(Collections.emptyList(), timeline.at(6000));
        assertEquals(Arrays.asList(first), timeline.at(3000));
        assertEquals(2000, timeline.nextBoundary(1000));
        assertEquals(5000, timeline.nextBoundary(4000));
        assertEquals(Long.MAX_VALUE, timeline.nextBoundary(6000));
    }

    @Test public void unchangedCaptionIntervalsReuseTheirSnapshot() {
        NativeCaptionTimeline.Entry first = new NativeCaptionTimeline.Entry(2000, 5000, "Hello");
        NativeCaptionTimeline timeline = new NativeCaptionTimeline(Arrays.asList(first));
        assertSame(timeline.at(2000), timeline.at(2500));
        assertSame(timeline.at(5000), timeline.at(9000));
    }

    @Test public void unsortedOverlappingCuesKeepOriginalOrderAcrossSeeks() {
        NativeCaptionTimeline.Entry later = new NativeCaptionTimeline.Entry(4000, 6000, "Later");
        NativeCaptionTimeline.Entry early = new NativeCaptionTimeline.Entry(1000, 9000, "Long");
        NativeCaptionTimeline.Entry sameStart = new NativeCaptionTimeline.Entry(4000, 5000, "Same start");
        NativeCaptionTimeline timeline = new NativeCaptionTimeline(Arrays.asList(later, early, sameStart));
        for (long position : new long[] {4000, 5000, 9000, 3999, 1000, 6000, 4000}) {
            java.util.List<NativeCaptionTimeline.Entry> expected = new java.util.ArrayList<>();
            long boundary = Long.MAX_VALUE;
            for (NativeCaptionTimeline.Entry cue : Arrays.asList(later, early, sameStart)) {
                if (cue.startMs <= position && position < cue.endMs) expected.add(cue);
                if (cue.startMs > position) boundary = Math.min(boundary, cue.startMs);
                if (cue.endMs > position) boundary = Math.min(boundary, cue.endMs);
            }
            assertEquals(expected, timeline.at(position));
            assertEquals(boundary, timeline.nextBoundary(position));
        }
    }
}
