package org.opentubex.app;

import static org.junit.Assert.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;

public class NativeAudioSpectrumTest {
    @Test public void decodedToneProducesTheExpectedFrequencyWithoutConsumingAudio() {
        NativeAudioSpectrum spectrum = new NativeAudioSpectrum();
        ByteBuffer audio = ByteBuffer.allocate(512).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < 256; i++) audio.putShort((short) (1000 * Math.sin(2 * Math.PI * 10 * i / 256)));
        audio.flip();
        spectrum.append(audio, 1);
        assertEquals(0, audio.position());
        int[] bins = spectrum.snapshot();
        int peak = 0;
        for (int i = 1; i < bins.length; i++) if (bins[i] > bins[peak]) peak = i;
        assertEquals(10, peak);
        assertTrue(bins[peak] > 0);
    }

    @Test public void resetRemovesThePreviousSourcesSpectrum() {
        NativeAudioSpectrum spectrum = new NativeAudioSpectrum();
        ByteBuffer audio = ByteBuffer.allocate(512).order(ByteOrder.LITTLE_ENDIAN);
        while (audio.hasRemaining()) audio.putShort((short) 16000);
        audio.flip();
        spectrum.append(audio, 1);
        spectrum.reset();
        for (int bin : spectrum.snapshot()) assertEquals(0, bin);
    }

    @Test public void fftMatchesReferenceTransformForStereoAndWrappedWindows() {
        NativeAudioSpectrum spectrum = new NativeAudioSpectrum();
        double[] expectedSamples = new double[256];
        java.util.Random random = new java.util.Random(19);
        for (int pass = 0; pass < 3; pass++) {
            ByteBuffer buffer = ByteBuffer.allocate(600 * 4).order(ByteOrder.LITTLE_ENDIAN);
            for (int i = 0; i < 600; i++) {
                short left = (short) random.nextInt();
                short right = (short) random.nextInt();
                buffer.putShort(left).putShort(right);
                if (i >= 344) expectedSamples[i - 344] = (left + (double) right) / 65536.0;
            }
            buffer.flip();
            spectrum.append(buffer, 2);
            int[] actual = spectrum.snapshot();
            for (int bin = 0; bin < 128; bin++) {
                double real = 0, imaginary = 0;
                for (int i = 0; i < 256; i++) {
                    double windowed = expectedSamples[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 256));
                    double phase = 2 * Math.PI * bin * i / 256;
                    real += windowed * Math.cos(phase);
                    imaginary -= windowed * Math.sin(phase);
                }
                double db = 20 * Math.log10(Math.max(1e-8, Math.hypot(real, imaginary) / 256));
                int expected = (int) Math.max(0, Math.min(255, (db + 100) / 70 * 255));
                assertEquals("bin " + bin, expected, actual[bin], 1);
            }
        }
    }
}
