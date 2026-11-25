package org.opentubex.app;

import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** One running artwork request and only the newest pending replacement. */
final class ArtworkRequestQueue implements AutoCloseable {
    static final class Request {
        private volatile boolean cancelled;
        private Runnable cancellation;

        boolean isCancelled() { return cancelled; }

        void onCancel(Runnable action) {
            synchronized (this) {
                if (!cancelled) { cancellation = action; return; }
            }
            if (action != null) action.run();
        }

        void cancel() {
            Runnable action;
            synchronized (this) {
                cancelled = true;
                action = cancellation;
                cancellation = null;
            }
            if (action != null) action.run();
        }
    }

    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        new LinkedBlockingQueue<>());
    private Request current;

    synchronized void replace(Consumer<Request> load) {
        cancel();
        if (executor.isShutdown() || load == null) return;
        Request request = new Request();
        current = request;
        executor.execute(() -> {
            if (!request.isCancelled()) load.accept(request);
        });
    }

    synchronized void cancel() {
        if (current != null) current.cancel();
        current = null;
        executor.getQueue().clear();
    }

    @Override public synchronized void close() {
        cancel();
        executor.shutdownNow();
    }
}
