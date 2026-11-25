package org.opentubex.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class SubscriptionRefreshResultIndexTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test
    public void drainingLargeBacklogsReadsBodiesOnlyOnceToIndexAndOnceToConsume() throws Exception {
        File directory = temporary.newFolder();
        for (int i = 0; i < 900; i++) {
            Files.write(new File(directory, "slot-" + i + ".json").toPath(), String.format("%013d", i).getBytes(StandardCharsets.UTF_8));
        }
        AtomicInteger reads = new AtomicInteger();
        SubscriptionRefreshResultIndex.IdReader readId = file -> {
            reads.incrementAndGet();
            return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
        };
        SubscriptionRefreshResultIndex index = new SubscriptionRefreshResultIndex(directory, readId);
        for (int i = 0; i < 900; i++) {
            File file = index.first();
            String id = readId.read(file);
            assertEquals(String.format("%013d", i), id);
            assertEquals(file, index.get(id));
            assertTrue(file.delete());
            index.remove(file);
        }
        assertNull(index.first());
        assertEquals(1800, reads.get());
    }

    @Test
    public void oldAcknowledgementsCannotDeleteReplacedSlotsAndRestartKeepsOrder() throws Exception {
        File directory = temporary.newFolder();
        File slot = new File(directory, "slot.json");
        File other = new File(directory, "other.json");
        Files.write(slot.toPath(), "001".getBytes(StandardCharsets.UTF_8));
        Files.write(other.toPath(), "002".getBytes(StandardCharsets.UTF_8));
        SubscriptionRefreshResultIndex index = new SubscriptionRefreshResultIndex(directory, file -> new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        Files.write(slot.toPath(), "003".getBytes(StandardCharsets.UTF_8));
        index.put(slot, "003");
        assertNull(index.get("001"));
        assertEquals(other, index.first());
        assertEquals(slot, index.get("003"));

        SubscriptionRefreshResultIndex restarted = new SubscriptionRefreshResultIndex(directory, file -> new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        assertEquals(other, restarted.first());
        assertNull(restarted.get("001"));
        assertEquals(slot, restarted.get("003"));
    }
}
