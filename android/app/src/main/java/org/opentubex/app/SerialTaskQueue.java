package org.opentubex.app;

import java.util.ArrayDeque;

final class SerialTaskQueue {
    private final ArrayDeque<Runnable> tasks = new ArrayDeque<>();
    private boolean running;

    void enqueue(Runnable task) {
        tasks.addLast(task);
        startNext();
    }

    void complete() {
        if (!running) {
            throw new IllegalStateException("No queued task is running");
        }

        running = false;
        startNext();
    }

    int pendingCount() {
        return tasks.size();
    }

    boolean isRunning() {
        return running;
    }

    private void startNext() {
        if (running || tasks.isEmpty()) return;

        running = true;
        tasks.removeFirst().run();
    }
}
