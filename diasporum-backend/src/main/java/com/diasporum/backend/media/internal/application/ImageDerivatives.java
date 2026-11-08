package com.diasporum.backend.media.internal.application;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import javax.imageio.ImageIO;

/**
 * Server-side privacy derivatives. Pixelation is used instead of a soft blur:
 * a downscale/upscale mosaic is irreversible, so the original features cannot
 * be recovered from the derivative — a soft Gaussian blur could be partially
 * deblurred. Output is always JPEG so one writer covers every source format.
 */
final class ImageDerivatives {

    /** Long-edge target of the intermediate mosaic — small enough to anonymise. */
    private static final int MOSAIC_PIXELS = 24;

    private ImageDerivatives() {
    }

    /**
     * Decodes {@code source}, pixelates it and returns JPEG bytes.
     *
     * @throws IllegalArgumentException when the source is not a decodable image
     */
    static byte[] blur(byte[] source) {
        ImageIO.setUseCache(false);
        BufferedImage decoded;
        try {
            decoded = ImageIO.read(new ByteArrayInputStream(source));
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("UNDECODABLE_IMAGE", e);
        }
        if (decoded == null) {
            throw new IllegalArgumentException("UNDECODABLE_IMAGE");
        }
        int width = decoded.getWidth();
        int height = decoded.getHeight();
        double scale = (double) MOSAIC_PIXELS / Math.max(width, height);
        int smallW = Math.max(1, (int) Math.round(width * scale));
        int smallH = Math.max(1, (int) Math.round(height * scale));

        BufferedImage tiny = new BufferedImage(smallW, smallH,
                BufferedImage.TYPE_INT_RGB);
        Graphics2D g = tiny.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(decoded, 0, 0, smallW, smallH, null);
        g.dispose();

        BufferedImage out = new BufferedImage(width, height,
                BufferedImage.TYPE_INT_RGB);
        g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR);
        g.drawImage(tiny, 0, 0, width, height, null);
        g.dispose();

        var bytes = new ByteArrayOutputStream(Math.max(4096, source.length / 4));
        try {
            ImageIO.write(out, "jpg", bytes);
        } catch (java.io.IOException e) {
            throw new IllegalStateException("DERIVATIVE_ENCODE_FAILED", e);
        }
        return bytes.toByteArray();
    }
}
