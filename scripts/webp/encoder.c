#include <stdint.h>
#include "webp/encode.h"

static WebPMemoryWriter output;

int encode_webp(const uint8_t* rgba, int width, int height, int lossless,
                int quality, int alpha_quality, int method, int sharp_yuv,
                int exact, int near_lossless) {
  WebPConfig config;
  WebPPicture picture;
  if (!WebPConfigInit(&config) || !WebPPictureInit(&picture)) return 0;

  config.lossless = lossless;
  config.quality = quality;
  config.alpha_quality = alpha_quality;
  config.method = method;
  config.use_sharp_yuv = sharp_yuv;
  config.exact = exact;
  config.near_lossless = near_lossless;
  if (!WebPValidateConfig(&config)) return 0;

  WebPMemoryWriterInit(&output);
  picture.use_argb = lossless || sharp_yuv;
  picture.width = width;
  picture.height = height;
  picture.writer = WebPMemoryWrite;
  picture.custom_ptr = &output;
  const int ok = WebPPictureImportRGBA(&picture, rgba, width * 4) &&
                 WebPEncode(&config, &picture);
  WebPPictureFree(&picture);
  if (!ok) {
    WebPMemoryWriterClear(&output);
    return 0;
  }
  return (int)output.size;
}

const uint8_t* webp_output(void) { return output.mem; }

void clear_webp_output(void) { WebPMemoryWriterClear(&output); }
