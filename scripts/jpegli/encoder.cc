#include <stddef.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <jpeglib.h>
#include <emscripten/heap.h>

#include "lib/jpegli/encode.h"

namespace {

struct JpegliErrorManager {
  jpeg_error_mgr pub;
};

struct EncodingError {};

struct EncodeState;

struct MemoryDestination {
  jpeg_destination_mgr pub;
  EncodeState* state;
  size_t capacity;
};

struct EncodeState {
  jpeg_compress_struct cinfo;
  JpegliErrorManager error;
  MemoryDestination destination;
  unsigned char* output;
  size_t output_size;
  bool created;
};

void ErrorExit(j_common_ptr cinfo) {
  (void)cinfo;
  throw EncodingError{};
}

void StoreU32Le(uint8_t* out, uint32_t value) {
  out[0] = static_cast<uint8_t>(value);
  out[1] = static_cast<uint8_t>(value >> 8);
  out[2] = static_cast<uint8_t>(value >> 16);
  out[3] = static_cast<uint8_t>(value >> 24);
}

void InitDestination(j_compress_ptr cinfo) {
  auto* destination = reinterpret_cast<MemoryDestination*>(cinfo->dest);
  auto* state = destination->state;
  if (state->output == nullptr) {
    constexpr size_t initial_capacity = 64 * 1024;
    state->output = static_cast<unsigned char*>(malloc(initial_capacity));
    if (state->output == nullptr) throw EncodingError{};
    destination->capacity = initial_capacity;
  }
  destination->pub.next_output_byte = state->output;
  destination->pub.free_in_buffer = destination->capacity;
}

boolean GrowDestination(j_compress_ptr cinfo) {
  auto* destination = reinterpret_cast<MemoryDestination*>(cinfo->dest);
  auto* state = destination->state;
  const size_t old_capacity = destination->capacity;
  if (old_capacity == 0 || old_capacity > UINT32_MAX / 2)
    throw EncodingError{};
  const size_t new_capacity = old_capacity * 2;
  auto* grown = static_cast<unsigned char*>(realloc(state->output, new_capacity));
  if (grown == nullptr) throw EncodingError{};
  state->output = grown;
  destination->capacity = new_capacity;
  destination->pub.next_output_byte = grown + old_capacity;
  destination->pub.free_in_buffer = new_capacity - old_capacity;
  return TRUE;
}

void FinishDestination(j_compress_ptr cinfo) {
  auto* destination = reinterpret_cast<MemoryDestination*>(cinfo->dest);
  destination->state->output_size =
      destination->capacity - destination->pub.free_in_buffer;
}

int Cleanup(EncodeState* state, int status) {
  if (state->created) jpegli_destroy_compress(&state->cinfo);
  free(state->output);
  free(state);
  return status;
}

bool IsHeapRange(const void* pointer, uint64_t length) {
  if (pointer == nullptr) return false;
  const uint64_t start = reinterpret_cast<uintptr_t>(pointer);
  const uint64_t end = start + length;
  return end >= start && end <= emscripten_get_heap_size();
}

}  // namespace

extern "C" int jpegli_encode(const uint8_t* rgba, uint32_t rgba_length,
                              int width, int height, int mode, int value,
                              int subsample, int progressive_level,
                              int adaptive_quantization,
                              int optimize_coding, uint8_t* result) {
  if (rgba == nullptr || width <= 0 || height <= 0 || width > 8192 ||
      height > 8192 || mode < 0 || mode > 1 ||
      (mode == 0 && (value < 1 || value > 100)) ||
      (mode == 1 && (value < 1 || value > 250)) ||
      (subsample != 444 && subsample != 440 && subsample != 422 &&
       subsample != 420) ||
      progressive_level < 0 || progressive_level > 2 ||
      (progressive_level > 0 && optimize_coding == 0) ||
      (adaptive_quantization != 0 && adaptive_quantization != 1) ||
      (optimize_coding != 0 && optimize_coding != 1))
    return 1;

  const uint64_t pixels = static_cast<uint64_t>(width) * height;
  const uint64_t input_size = pixels * 4;
  if (pixels > 16000000 || input_size != rgba_length ||
      !IsHeapRange(rgba, input_size) || !IsHeapRange(result, 8))
    return 1;
  const uint64_t input_start = reinterpret_cast<uintptr_t>(rgba);
  const uint64_t result_start = reinterpret_cast<uintptr_t>(result);
  if (input_start < result_start + 8 && result_start < input_start + input_size)
    return 1;
  memset(result, 0, 8);

  auto* state = static_cast<EncodeState*>(calloc(1, sizeof(EncodeState)));
  if (state == nullptr) return 2;
  state->cinfo.err = jpegli_std_error(&state->error.pub);
  state->error.pub.error_exit = ErrorExit;
  try {
    state->created = true;
    jpegli_create_compress(&state->cinfo);
    // Keep allocations owned by this call below the Wasm memory ceiling.
    state->cinfo.mem->max_memory_to_use = 1073741824L;
    state->cinfo.image_width = static_cast<JDIMENSION>(width);
    state->cinfo.image_height = static_cast<JDIMENSION>(height);
    state->cinfo.input_components = 4;
    state->cinfo.in_color_space = JCS_EXT_RGBA;
    jpegli_set_defaults(&state->cinfo);

    state->cinfo.comp_info[0].h_samp_factor =
        (subsample == 444 || subsample == 440) ? 1 : 2;
    state->cinfo.comp_info[0].v_samp_factor =
        (subsample == 420 || subsample == 440) ? 2 : 1;
    state->cinfo.comp_info[1].h_samp_factor = 1;
    state->cinfo.comp_info[1].v_samp_factor = 1;
    state->cinfo.comp_info[2].h_samp_factor = 1;
    state->cinfo.comp_info[2].v_samp_factor = 1;

    if (mode == 0) {
      jpegli_set_distance(&state->cinfo,
                          jpegli_quality_to_distance(value), TRUE);
    } else {
      jpegli_set_distance(&state->cinfo,
                          static_cast<float>(value) / 10.0f, TRUE);
    }
    jpegli_enable_adaptive_quantization(
        &state->cinfo, adaptive_quantization ? TRUE : FALSE);
    jpegli_set_progressive_level(&state->cinfo, progressive_level);
    state->cinfo.optimize_coding = optimize_coding ? TRUE : FALSE;

    state->destination.state = state;
    state->destination.capacity = 0;
    state->destination.pub.init_destination = InitDestination;
    state->destination.pub.empty_output_buffer = GrowDestination;
    state->destination.pub.term_destination = FinishDestination;
    state->cinfo.dest = &state->destination.pub;
    jpegli_start_compress(&state->cinfo, TRUE);
    while (state->cinfo.next_scanline < state->cinfo.image_height) {
      const size_t source_row =
          static_cast<size_t>(state->cinfo.next_scanline) * width * 4;
      JSAMPROW row = const_cast<JSAMPROW>(rgba + source_row);
      if (jpegli_write_scanlines(&state->cinfo, &row, 1) != 1)
        throw EncodingError{};
    }
    jpegli_finish_compress(&state->cinfo);
    jpegli_destroy_compress(&state->cinfo);
    state->created = false;
  } catch (...) {
    return Cleanup(state, 2);
  }

  if (state->output == nullptr || state->output_size == 0 ||
      state->output_size > UINT32_MAX ||
      reinterpret_cast<uintptr_t>(state->output) > UINT32_MAX) {
    return Cleanup(state, 2);
  }
  StoreU32Le(result, static_cast<uint32_t>(reinterpret_cast<uintptr_t>(state->output)));
  StoreU32Le(result + 4, static_cast<uint32_t>(state->output_size));
  state->output = nullptr;
  return Cleanup(state, 0);
}
