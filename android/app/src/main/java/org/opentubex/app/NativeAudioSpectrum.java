package org.opentubex.app;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** A small copy of decoded audio for visualization, without microphone access. */
final class NativeAudioSpectrum {
    private static final int SIZE = 256;
    private static final double[] HANN = new double[SIZE];
    private static final double[] COS = new double[SIZE / 2];
    private static final double[] SIN = new double[SIZE / 2];
    static {
        for (int i = 0; i < SIZE; i++) HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE);
        for (int i = 0; i < SIZE / 2; i++) {
            COS[i] = Math.cos(2 * Math.PI * i / SIZE);
            SIN[i] = -Math.sin(2 * Math.PI * i / SIZE);
        }
    }
    private final double[] samples = new double[SIZE];
    private int next;

    synchronized void reset() {
        java.util.Arrays.fill(samples, 0);
        next = 0;
    }

    synchronized void append(ByteBuffer input, int channels) {
        if (channels <= 0) return;
        ByteBuffer buffer = input.duplicate().order(ByteOrder.LITTLE_ENDIAN);
        // Only the latest window is needed; do not copy the whole decoded buffer.
        int frames = buffer.remaining() / (channels * 2);
        buffer.position(buffer.position() + Math.max(0, frames - SIZE) * channels * 2);
        while (buffer.remaining() >= channels * 2) {
            double sample = 0;
            for (int channel = 0; channel < channels; channel++) sample += buffer.getShort() / 32768.0;
            samples[next] = sample / channels;
            next = (next + 1) % SIZE;
        }
    }

    int[] snapshot() {
        double[] real = new double[SIZE];
        double[] imaginary = new double[SIZE];
        synchronized (this) {
            System.arraycopy(samples, next, real, 0, SIZE - next);
            System.arraycopy(samples, 0, real, SIZE - next, next);
        }
        for (int i = 0; i < SIZE; i++) real[i] *= HANN[i];
        // Radix-2 FFT: 1,024 butterflies instead of 32,768 trigonometric steps.
        for (int i = 0; i < SIZE; i++) {
            int reversed = Integer.reverse(i) >>> (Integer.SIZE - 8);
            if (reversed > i) {
                double value = real[i];
                real[i] = real[reversed];
                real[reversed] = value;
            }
        }
        for (int length = 2; length <= SIZE; length *= 2) {
            int half = length / 2;
            int step = SIZE / length;
            for (int start = 0; start < SIZE; start += length) {
                for (int i = 0; i < half; i++) {
                    int even = start + i;
                    int odd = even + half;
                    double re = real[odd] * COS[i * step] - imaginary[odd] * SIN[i * step];
                    double im = real[odd] * SIN[i * step] + imaginary[odd] * COS[i * step];
                    real[odd] = real[even] - re;
                    imaginary[odd] = imaginary[even] - im;
                    real[even] += re;
                    imaginary[even] += im;
                }
            }
        }
        int[] bins = new int[SIZE / 2];
        for (int bin = 0; bin < bins.length; bin++) {
            double magnitude = Math.hypot(real[bin], imaginary[bin]) / SIZE;
            double decibels = 20 * Math.log10(Math.max(1e-8, magnitude));
            bins[bin] = (int) Math.max(0, Math.min(255, (decibels + 100) / 70 * 255));
        }
        return bins;
    }
}
