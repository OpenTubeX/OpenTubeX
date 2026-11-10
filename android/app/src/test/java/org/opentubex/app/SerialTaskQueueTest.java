package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class SerialTaskQueueTest {
    @Test
    public void runsTasksOneAtATimeInSubmissionOrder() {
        SerialTaskQueue queue = new SerialTaskQueue();
        List<Integer> started = new ArrayList<>();

        queue.enqueue(() -> started.add(1));
        queue.enqueue(() -> started.add(2));
        queue.enqueue(() -> started.add(3));

        assertEquals(List.of(1), started);
        assertTrue(queue.isRunning());
        assertEquals(2, queue.pendingCount());

        queue.complete();
        assertEquals(List.of(1, 2), started);
        assertEquals(1, queue.pendingCount());

        queue.complete();
        assertEquals(List.of(1, 2, 3), started);

        queue.complete();
        assertFalse(queue.isRunning());
        assertEquals(0, queue.pendingCount());
    }
}
