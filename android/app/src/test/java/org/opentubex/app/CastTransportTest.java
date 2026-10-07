package org.opentubex.app;

import static org.junit.Assert.*;
import java.io.BufferedReader;
import java.io.Reader;
import java.io.StringReader;
import java.util.Arrays;
import org.junit.Test;

public class CastTransportTest {
    @Test public void readsSeparateMessagesAndFinalUnterminatedMessage() throws Exception {
        try (var reader = new BufferedReader(new StringReader("{}\n{\"event\":\"connected\"}\n{\"event\":\"closed\"}"))) {
            assertEquals("{}", CastTransport.readMessage(reader));
            assertEquals("{\"event\":\"connected\"}", CastTransport.readMessage(reader));
            assertEquals("{\"event\":\"closed\"}", CastTransport.readMessage(reader));
            assertNull(CastTransport.readMessage(reader));
        }
    }

    @Test public void acceptsMessageAtTheExistingLimit() throws Exception {
        try (var reader = new BufferedReader(new StringReader("x".repeat(1_100_000) + "\n"))) {
            assertEquals(1_100_000, CastTransport.readMessage(reader).length());
            assertNull(CastTransport.readMessage(reader));
        }
    }

    @Test public void rejectsOversizedMessageWithoutConsumingTheWholeLine() throws Exception {
        var source = new Reader() {
            int consumed;
            @Override public int read(char[] buffer, int offset, int length) {
                int count = Math.min(length, 1_200_000 - consumed);
                if (count == 0) return -1;
                Arrays.fill(buffer, offset, offset + count, 'x');
                consumed += count;
                return count;
            }
            @Override public void close() {}
        };
        try (var reader = new BufferedReader(source)) {
            try { CastTransport.readMessage(reader); fail("Oversized message accepted"); }
            catch (IllegalArgumentException expected) { assertEquals("Cast message too large", expected.getMessage()); }
            // BufferedReader may prefetch one additional 8 KiB buffer.
            assertTrue("Stop reading at the limit", source.consumed <= 1_100_001 + 8192);
        }
    }
}
