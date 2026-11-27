#include <jxl/encode.h>
#include <jxl/color_encoding.h>
#include <jxl/types.h>

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

enum {
  JXL_WRAPPER_OK = 0,
  JXL_WRAPPER_INVALID_ARGUMENT = -1,
  JXL_WRAPPER_OUT_OF_MEMORY = -2,
  JXL_WRAPPER_ENCODE_ERROR = -3
};

static uint8_t *output;
static size_t output_size;

void jxl_free_output(void) {
  free(output);
  output = NULL;
  output_size = 0;
}

const uint8_t *jxl_output(void) { return output; }

size_t jxl_output_size(void) { return output_size; }

static int set_info(JxlEncoder *encoder, uint32_t width, uint32_t height,
                    int lossless) {
  JxlBasicInfo info;
  JxlEncoderInitBasicInfo(&info);
  info.xsize = width;
  info.ysize = height;
  info.bits_per_sample = 8;
  info.exponent_bits_per_sample = 0;
  info.num_color_channels = 3;
  info.num_extra_channels = 1;
  info.alpha_bits = 8;
  info.alpha_exponent_bits = 0;
  info.alpha_premultiplied = JXL_FALSE;
  info.uses_original_profile = lossless ? JXL_TRUE : JXL_FALSE;
  if (JxlEncoderSetBasicInfo(encoder, &info) != JXL_ENC_SUCCESS) return 0;

  JxlExtraChannelInfo alpha;
  JxlEncoderInitExtraChannelInfo(JXL_CHANNEL_ALPHA, &alpha);
  alpha.bits_per_sample = 8;
  alpha.exponent_bits_per_sample = 0;
  alpha.alpha_premultiplied = JXL_FALSE;
  return JxlEncoderSetExtraChannelInfo(encoder, 0, &alpha) == JXL_ENC_SUCCESS;
}

int jxl_encode(const uint8_t *rgba, size_t rgba_length, uint32_t width,
               uint32_t height, int distance_tenths, int effort,
               int lossless) {
  JxlEncoder *encoder = NULL;
  JxlEncoderFrameSettings *frame = NULL;
  JxlColorEncoding color;
  JxlPixelFormat format = {4, JXL_TYPE_UINT8, JXL_NATIVE_ENDIAN, 0};
  uint64_t pixels;
  size_t required;
  uint8_t *next_output = NULL;
  size_t next_capacity = 0;
  size_t next_size = 0;
  int result = JXL_WRAPPER_ENCODE_ERROR;

  jxl_free_output();
  if (rgba == NULL || width == 0 || height == 0 || width > 8192 ||
      height > 8192 || effort < 1 || effort > 10 ||
      (lossless != 0 && lossless != 1) ||
      (lossless ? distance_tenths != 0
                : (distance_tenths < 1 || distance_tenths > 150)))
    return JXL_WRAPPER_INVALID_ARGUMENT;
  pixels = (uint64_t)width * (uint64_t)height;
  if (pixels > 16000000 || pixels > SIZE_MAX / 4)
    return JXL_WRAPPER_INVALID_ARGUMENT;
  required = (size_t)pixels * 4;
  if (rgba_length != required) return JXL_WRAPPER_INVALID_ARGUMENT;

  encoder = JxlEncoderCreate(NULL);
  if (encoder == NULL) return JXL_WRAPPER_OUT_OF_MEMORY;
  frame = JxlEncoderFrameSettingsCreate(encoder, NULL);
  if (frame == NULL) {
    result = JXL_WRAPPER_OUT_OF_MEMORY;
    goto cleanup;
  }
  if (JxlEncoderFrameSettingsSetOption(frame, JXL_ENC_FRAME_SETTING_EFFORT,
                                       effort) != JXL_ENC_SUCCESS ||
      JxlEncoderSetFrameLossless(frame, lossless ? JXL_TRUE : JXL_FALSE) !=
          JXL_ENC_SUCCESS ||
      JxlEncoderFrameSettingsSetOption(
          frame, JXL_ENC_FRAME_SETTING_KEEP_INVISIBLE, lossless) !=
          JXL_ENC_SUCCESS ||
      JxlEncoderFrameSettingsSetOption(
          frame, JXL_ENC_FRAME_SETTING_EXTRA_CHANNEL_RESAMPLING, 1) !=
          JXL_ENC_SUCCESS ||
      JxlEncoderFrameSettingsSetOption(
          frame, JXL_ENC_FRAME_SETTING_RESAMPLING, 1) != JXL_ENC_SUCCESS ||
      (!lossless && JxlEncoderSetFrameDistance(
                         frame, (float)distance_tenths / 10.0f) !=
                         JXL_ENC_SUCCESS) ||
      !set_info(encoder, width, height, lossless))
    goto cleanup;
  if (JxlEncoderSetExtraChannelDistance(frame, 0, 0.0f) != JXL_ENC_SUCCESS)
    goto cleanup;

  JxlColorEncodingSetToSRGB(&color, JXL_FALSE);
  if (JxlEncoderSetColorEncoding(encoder, &color) != JXL_ENC_SUCCESS ||
      JxlEncoderAddImageFrame(frame, &format, rgba, rgba_length) !=
          JXL_ENC_SUCCESS)
    goto cleanup;
  JxlEncoderCloseInput(encoder);

  for (;;) {
    if (next_capacity - next_size < 65536) {
      size_t capacity = next_capacity ? next_capacity * 2 : 65536;
      if (capacity < next_capacity) {
        result = JXL_WRAPPER_OUT_OF_MEMORY;
        goto cleanup;
      }
      uint8_t *grown = (uint8_t *)realloc(next_output, capacity);
      if (grown == NULL) {
        result = JXL_WRAPPER_OUT_OF_MEMORY;
        goto cleanup;
      }
      next_output = grown;
      next_capacity = capacity;
    }
    uint8_t *position = next_output + next_size;
    size_t available = next_capacity - next_size;
    JxlEncoderStatus status = JxlEncoderProcessOutput(encoder, &position,
                                                       &available);
    next_size = (size_t)(position - next_output);
    if (status == JXL_ENC_SUCCESS) break;
    if (status != JXL_ENC_NEED_MORE_OUTPUT) goto cleanup;
  }

  output = next_output;
  output_size = next_size;
  next_output = NULL;
  result = JXL_WRAPPER_OK;

cleanup:
  free(next_output);
  if (result == JXL_WRAPPER_ENCODE_ERROR && encoder != NULL &&
      JxlEncoderGetError(encoder) == JXL_ENC_ERR_OOM)
    result = JXL_WRAPPER_OUT_OF_MEMORY;
  if (encoder != NULL) JxlEncoderDestroy(encoder);
  return result;
}
