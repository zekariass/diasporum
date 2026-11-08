package com.diasporum.backend.media.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

/** Pixelation derivative: irreversible mosaic, JPEG output, source dimensions. */
class ImageDerivativesTest {

    private static byte[] gradientPng(int size) throws Exception {
        var image = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < size; x++) {
            for (int y = 0; y < size; y++) {
                image.setRGB(x, y, (x * 7 + y * 13) % 256 << 16
                        | (x + y * 3) % 256 << 8 | (x * y) % 256);
            }
        }
        var out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    @Test
    void blurProducesDecodableJpegAtSourceDimensions() throws Exception {
        byte[] blurred = ImageDerivatives.blur(gradientPng(96));
        var decoded = ImageIO.read(new ByteArrayInputStream(blurred));
        assertNotNull(decoded);
        assertEquals(96, decoded.getWidth());
        assertEquals(96, decoded.getHeight());
        assertNotEquals(java.util.Arrays.hashCode(gradientPng(96)),
                java.util.Arrays.hashCode(blurred));
    }

    @Test
    void blurTurnsFineDetailIntoUniformMosaic() throws Exception {
        // A 1px checkerboard is maximum-frequency detail — after pixelation every
        // cell must average to a flat mid-grey, proving identifying detail is gone.
        int size = 96;
        var board = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < size; x++) {
            for (int y = 0; y < size; y++) {
                board.setRGB(x, y, (x + y) % 2 == 0 ? 0xFFFFFF : 0x000000);
            }
        }
        var out = new ByteArrayOutputStream();
        ImageIO.write(board, "png", out);
        var blurred = ImageIO.read(new ByteArrayInputStream(
                ImageDerivatives.blur(out.toByteArray())));
        assertNotNull(blurred);
        for (int x = 0; x < size; x += 4) {
            for (int y = 0; y < size; y += 4) {
                int rgb = blurred.getRGB(x, y);
                int r = rgb >> 16 & 0xFF, g = rgb >> 8 & 0xFF, b = rgb & 0xFF;
                assertTrue(r > 60 && r < 195 && g > 60 && g < 195 && b > 60 && b < 195,
                        "mosaic cell should be near mid-grey, got "
                                + Integer.toHexString(rgb));
            }
        }
    }

    @Test
    void undecodableInputIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> ImageDerivatives.blur("not an image".getBytes()));
    }
}
