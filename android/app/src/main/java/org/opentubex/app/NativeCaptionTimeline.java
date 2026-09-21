package org.opentubex.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.TreeSet;

/** Parsed external captions, evaluated against the primary decoder's clock. */
final class NativeCaptionTimeline {
    static final class Entry {
        final long startMs;
        final long endMs;
        final String text;

        Entry(long startMs, long endMs, String text) {
            this.startMs = startMs;
            this.endMs = endMs;
            this.text = text;
        }
    }

    private static final class Boundary {
        final long time;
        final int index;
        final boolean start;
        Boundary(long time, int index, boolean start) {
            this.time = time;
            this.index = index;
            this.start = start;
        }
    }

    private final List<Entry> entries;
    private final List<Boundary> boundaries = new ArrayList<>();
    private final TreeSet<Integer> active = new TreeSet<>();
    private List<Entry> snapshot = Collections.emptyList();
    private long position = Long.MIN_VALUE;
    private int cursor;

    NativeCaptionTimeline(List<Entry> entries) {
        this.entries = new ArrayList<>(entries);
        for (int i = 0; i < entries.size(); i++) {
            boundaries.add(new Boundary(entries.get(i).startMs, i, true));
            boundaries.add(new Boundary(entries.get(i).endMs, i, false));
        }
        boundaries.sort(Comparator.comparingLong(boundary -> boundary.time));
    }

    List<Entry> at(long positionMs) {
        boolean changed = false;
        if (positionMs < position) {
            // A backwards seek rebuilds once. Ordinary ticks only cross new boundaries.
            active.clear();
            for (int i = 0; i < entries.size(); i++) {
                Entry entry = entries.get(i);
                if (entry.startMs <= positionMs && positionMs < entry.endMs) active.add(i);
            }
            cursor = nextBoundaryIndex(positionMs);
            changed = true;
        } else {
            while (cursor < boundaries.size() && boundaries.get(cursor).time <= positionMs) {
                Boundary boundary = boundaries.get(cursor++);
                if (boundary.start) active.add(boundary.index);
                else active.remove(boundary.index);
                changed = true;
            }
        }
        position = positionMs;
        if (changed) {
            List<Entry> next = new ArrayList<>(active.size());
            // Preserve input order, including overlapping and simultaneous cues.
            for (int index : active) next.add(entries.get(index));
            snapshot = Collections.unmodifiableList(next);
        }
        return snapshot;
    }

    long nextBoundary(long positionMs) {
        int next = positionMs == position ? cursor : nextBoundaryIndex(positionMs);
        return next == boundaries.size() ? Long.MAX_VALUE : boundaries.get(next).time;
    }

    private int nextBoundaryIndex(long positionMs) {
        int low = 0;
        int high = boundaries.size();
        while (low < high) {
            int middle = (low + high) >>> 1;
            if (boundaries.get(middle).time <= positionMs) low = middle + 1;
            else high = middle;
        }
        return low;
    }
}
