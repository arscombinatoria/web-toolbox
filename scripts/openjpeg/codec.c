#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <openjpeg.h>

#define MAX_PIXELS 16000000u
#define MAX_SIDE 8192u
#define MAX_INPUT (32u * 1024u * 1024u)
#define MAX_GENERATED_INPUT (128u * 1024u * 1024u)
#define MAX_TILES 4096u
#define MAX_DECODE_BYTES (768ull * 1024ull * 1024ull)

static uint8_t *encoded;
static OPJ_SIZE_T encoded_size;
static uint32_t decoded_width, decoded_height;

static void quiet(const char *msg, void *data) { (void)msg; (void)data; }

static void clear_encoded(void) { free(encoded); encoded = NULL; encoded_size = 0; }
uint32_t jp2_output_size(void) { return (uint32_t)encoded_size; }
uint32_t jp2_output(void) { return (uint32_t)(uintptr_t)encoded; }
void jp2_clear_output(void) { clear_encoded(); }
uint32_t jp2_width(void) { return decoded_width; }
uint32_t jp2_height(void) { return decoded_height; }

typedef struct { const uint8_t *data; OPJ_SIZE_T length, offset; } Input;
static OPJ_SIZE_T read_input(void *buffer, OPJ_SIZE_T size, void *user) {
  Input *in = (Input *)user;
  OPJ_SIZE_T left = in->length - in->offset;
  if (!left) return (OPJ_SIZE_T)-1;
  if (size > left) size = left;
  memcpy(buffer, in->data + in->offset, size);
  in->offset += size;
  return size;
}
static OPJ_OFF_T skip_input(OPJ_OFF_T amount, void *user) {
  Input *in = (Input *)user;
  if (amount < 0 || (uint64_t)amount > in->length - in->offset) return -1;
  in->offset += (OPJ_SIZE_T)amount;
  return amount;
}
static OPJ_BOOL seek_input(OPJ_OFF_T offset, void *user) {
  Input *in = (Input *)user;
  if (offset < 0 || (uint64_t)offset > in->length) return OPJ_FALSE;
  in->offset = (OPJ_SIZE_T)offset;
  return OPJ_TRUE;
}

/* OpenJPEG expands JP2 palettes into image components, but reject these boxes
 * until the caller can distinguish and verify every channel mapping. */
static uint32_t be32(const uint8_t *p) {
  return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];
}
static uint16_t be16(const uint8_t *p) { return (uint16_t)(((uint16_t)p[0]<<8)|p[1]); }

static int jp2_unsupported_boxes(const uint8_t *bytes, uint32_t length,
                                 uint32_t *cs_offset, uint32_t *cs_length) {
  *cs_offset=0; *cs_length=length;
  if (length < 12 || bytes[4] != 'j' || bytes[5] != 'P' || bytes[6] != ' ' || bytes[7] != ' ') return 0;
  uint32_t offset=0;
  while (offset < length) {
    if (length-offset < 8) return -1;
    uint64_t boxlen=be32(bytes+offset);
    uint32_t type=be32(bytes+offset+4);
    uint32_t header=8;
    if (boxlen==1) {
      if (length-offset<16) return -1;
      boxlen=0; for (unsigned i=0;i<8;i++) boxlen=(boxlen<<8)|bytes[offset+8+i]; header=16;
    } else if (boxlen==0) boxlen=length-offset;
    if (boxlen<header || boxlen>length-offset) return -1;
    if (type==0x6a703263) { /* jp2c codestream */
      if (*cs_length != length) return -1;
      *cs_offset=offset+header; *cs_length=(uint32_t)boxlen-header;
      offset+=(uint32_t)boxlen; continue;
    }
    if (type==0x6a703268) { /* jp2h children */
      uint32_t child=offset+header, end=offset+(uint32_t)boxlen;
      while (child<end) {
        if (end-child<8) return -1;
        uint64_t n=be32(bytes+child);
        uint32_t t=be32(bytes+child+4);
        uint32_t h=8;
        if (n==1) { if(end-child<16)return -1; n=0; for(unsigned i=0;i<8;i++)n=(n<<8)|bytes[child+8+i]; h=16; }
        else if(n==0)n=end-child;
        if(n<h || n>end-child)return -1;
        if(t==0x70636c72 || t==0x636d6170) return 1; /* pclr / cmap */
        if(t==0x636f6c72 && n>=h+3 && bytes[child+h]==2) return 1; /* ICC profile */
        if(t==0x63646566) { /* Reject premultiplied and unknown alpha channel types. */
          if(n<h+2) return -1;
          uint32_t channels=be16(bytes+child+h);
          if((uint64_t)h+2+(uint64_t)channels*6>n) return -1;
          for(uint32_t i=0;i<channels;i++) {
            uint16_t type=be16(bytes+child+h+4+i*6);
            if(type>1) return 1;
          }
        }
        child+=(uint32_t)n;
      }
    }
    offset+=(uint32_t)boxlen;
  }
  return 0;
}

/* Validate channel definitions before decode, including alpha placement. */
static int jp2_cdef_valid(const uint8_t *bytes, uint32_t length, uint32_t components, uint32_t base_channels) {
  if(length<12 || bytes[4]!='j' || bytes[5]!='P' || bytes[6]!=' ' || bytes[7]!=' ')
    return components==base_channels?0:1;
  uint8_t seen[4]={0}; uint32_t alpha_count=0;
  for(uint32_t offset=0;offset+8<=length;) {
    uint64_t n=be32(bytes+offset); uint32_t type=be32(bytes+offset+4), h=8;
    if(n==1) { if(length-offset<16)return -1; n=0; for(unsigned i=0;i<8;i++)n=(n<<8)|bytes[offset+8+i]; h=16; }
    else if(n==0)n=length-offset;
    if(n<h || n>length-offset)return -1;
    if(type==0x6a703268) {
      uint32_t child=offset+h,end=offset+(uint32_t)n;
      while(child<end) {
        uint64_t cn=be32(bytes+child); uint32_t ct=be32(bytes+child+4), ch=8;
        if(cn==1) { if(end-child<16)return -1; cn=0; for(unsigned i=0;i<8;i++)cn=(cn<<8)|bytes[child+8+i]; ch=16; }
        else if(cn==0)cn=end-child;
        if(cn<ch || cn>end-child)return -1;
        if(ct==0x63646566) {
          if(cn<ch+2)return -1;
          uint32_t count=be16(bytes+child+ch);
          if(count>components || (uint64_t)ch+2+(uint64_t)count*6>cn)return -1;
          for(uint32_t i=0;i<count;i++) {
            const uint8_t *entry=bytes+child+ch+2+i*6;
            uint32_t channel=be16(entry), kind=be16(entry+2), association=be16(entry+4);
            if(channel>=components || seen[channel] || kind>1)return -1;
            seen[channel]=1;
            if(kind==1) {
              if(++alpha_count>1 || channel!=components-1 || association!=0)return 1;
            } else if(!association || association>base_channels) return 1;
          }
        }
        child+=(uint32_t)cn;
      }
    }
    offset+=(uint32_t)n;
  }
  return components==base_channels+(alpha_count?1:0)?0:1;
}

/* Validate SIZ before OpenJPEG can allocate tile and component state. */
static int preflight_siz(const uint8_t *bytes, uint32_t length, uint32_t max_codestream) {
  if(length>max_codestream) return 1;
  if(length<44 || bytes[0]!=0xff || bytes[1]!=0x4f || bytes[2]!=0xff || bytes[3]!=0x51 ||
     bytes[length-2]!=0xff || bytes[length-1]!=0xd9) return -1;
  if(be16(bytes+6)&0xc000) return 2; /* Reject Part 2 and HTJ2K extension bits. */
  uint32_t siz=be16(bytes+4), components=be16(bytes+40);
  if(!components || components>4 || siz!=38+3*components || siz>length-4) return -1;
  uint32_t xsiz=be32(bytes+8), ysiz=be32(bytes+12), xosiz=be32(bytes+16), yosiz=be32(bytes+20);
  uint32_t xtsiz=be32(bytes+24), ytsiz=be32(bytes+28), xtosiz=be32(bytes+32), ytosiz=be32(bytes+36);
  if(xsiz<=xosiz || ysiz<=yosiz || !xtsiz || !ytsiz || xosiz<xtosiz || yosiz<ytosiz ||
     xsiz>INT32_MAX || ysiz>INT32_MAX || xosiz>INT32_MAX || yosiz>INT32_MAX ||
     xtosiz>INT32_MAX || ytosiz>INT32_MAX || xtsiz>INT32_MAX || ytsiz>INT32_MAX ||
     xtosiz>=xsiz || ytosiz>=ysiz) return -1;
  if((uint64_t)xtosiz+xtsiz>INT32_MAX || (uint64_t)ytosiz+ytsiz>INT32_MAX) return 1;
  uint32_t width=xsiz-xosiz, height=ysiz-yosiz;
  if(width>MAX_SIDE || height>MAX_SIDE || (uint64_t)width*height>MAX_PIXELS) return 1;
  uint64_t tw=((uint64_t)xsiz-xtosiz+xtsiz-1)/xtsiz;
  uint64_t th=((uint64_t)ysiz-ytosiz+ytsiz-1)/ytsiz;
  if(!tw || !th || tw*th>MAX_TILES) return 1;
  uint64_t samples=(uint64_t)width*height*4;
  for(uint32_t i=0;i<components;i++) {
    const uint8_t *c=bytes+42+i*3;
    uint32_t precision=(c[0]&0x7f)+1, dx=c[1], dy=c[2];
    if(!dx || !dy || precision>16) return 1;
    uint32_t cw=(xsiz+dx-1)/dx-(xosiz+dx-1)/dx;
    uint32_t ch=(ysiz+dy-1)/dy-(yosiz+dy-1)/dy;
    if(!cw || !ch || cw>MAX_SIDE || ch>MAX_SIDE || (uint64_t)cw*ch>MAX_PIXELS) return 1;
    samples+=(uint64_t)cw*ch*8;
  }
  return samples>MAX_DECODE_BYTES?1:0;
}

typedef struct { uint8_t *data; OPJ_SIZE_T position, length, capacity; } Output;
static OPJ_SIZE_T write_output(void *buffer, OPJ_SIZE_T size, void *user) {
  Output *out = (Output *)user;
  if (size > UINT32_MAX - out->position) return (OPJ_SIZE_T)-1;
  OPJ_SIZE_T need = out->position + size;
  if (need > out->capacity) {
    OPJ_SIZE_T cap = out->capacity ? out->capacity : 65536;
    while (cap < need) {
      if (cap > UINT32_MAX / 2) { cap = UINT32_MAX; break; }
      cap *= 2;
    }
    uint8_t *next = (uint8_t *)realloc(out->data, cap);
    if (!next) return (OPJ_SIZE_T)-1;
    out->data = next; out->capacity = cap;
  }
  memcpy(out->data + out->position, buffer, size);
  out->position = need;
  if (need > out->length) out->length = need;
  return size;
}
static OPJ_OFF_T skip_output(OPJ_OFF_T amount, void *user) {
  Output *out = (Output *)user;
  if (amount < 0 || (uint64_t)amount > UINT32_MAX - out->position) return -1;
  OPJ_SIZE_T next = out->position + (OPJ_SIZE_T)amount;
  if (next > out->capacity) {
    uint8_t *data = (uint8_t *)realloc(out->data, next);
    if (!data) return -1;
    out->data = data; out->capacity = next;
  }
  if (next > out->length) memset(out->data + out->length, 0, (size_t)(next-out->length));
  out->position = next;
  if (next > out->length) out->length = next;
  return amount;
}
static OPJ_BOOL seek_output(OPJ_OFF_T offset, void *user) {
  Output *out = (Output *)user;
  if (offset < 0 || (uint64_t)offset > UINT32_MAX) return OPJ_FALSE;
  if ((OPJ_SIZE_T)offset > out->capacity) {
    uint8_t *data = (uint8_t *)realloc(out->data, (OPJ_SIZE_T)offset);
    if (!data) return OPJ_FALSE;
    out->data = data; out->capacity = (OPJ_SIZE_T)offset;
  }
  if ((OPJ_SIZE_T)offset > out->length) memset(out->data + out->length, 0, (size_t)((OPJ_SIZE_T)offset - out->length));
  out->position = (OPJ_SIZE_T)offset;
  if (out->position > out->length) out->length = out->position;
  return OPJ_TRUE;
}

int jp2_encode(const uint8_t *rgba, uint32_t width, uint32_t height, uint32_t mode, float value) {
  clear_encoded();
  if (!rgba || !width || !height || width > MAX_SIDE || height > MAX_SIDE || width * (uint64_t)height > MAX_PIXELS || mode > 2) return -1;
  if (mode && (!isfinite(value) || value <= 0.0f || value > (mode == 1 ? 100.0f : 1000.0f))) return -2;
  opj_cparameters_t p; opj_set_default_encoder_parameters(&p);
  p.tcp_numlayers = 1; p.prog_order = OPJ_LRCP; p.tcp_mct = 1;
  p.irreversible = mode == 0 ? 0 : 1;
  p.numresolution = 1;
  uint32_t smallest = width < height ? width : height;
  while (p.numresolution < 6 && (1u << (p.numresolution)) <= smallest) ++p.numresolution;
  if (mode == 1) { p.cp_fixed_quality = 1; p.tcp_distoratio[0] = value; }
  else if (mode == 2) { p.cp_disto_alloc = 1; p.tcp_rates[0] = value; }
  else { p.cp_disto_alloc = 1; p.tcp_rates[0] = 0.0f; }
  opj_image_cmptparm_t cp[4]; memset(cp, 0, sizeof(cp));
  for (unsigned i=0; i<4; ++i) { cp[i].dx=cp[i].dy=1; cp[i].w=width; cp[i].h=height; cp[i].prec=8; }
  uint32_t channels=4;
  for(uint64_t i=0,n=(uint64_t)width*height;i<n;i++) {
    if(rgba[i*4+3]!=255) { channels=4; break; }
    channels=3;
  }
  opj_image_t *image = opj_image_create(channels, cp, OPJ_CLRSPC_SRGB);
  if (!image) return -3;
  image->x1=width; image->y1=height;
  if(channels==4) image->comps[3].alpha=1;
  for (uint64_t i=0, n=(uint64_t)width*height; i<n; ++i)
    for (uint32_t c=0; c<channels; ++c) image->comps[c].data[i]=rgba[i*4+c];
  opj_codec_t *codec=opj_create_compress(OPJ_CODEC_JP2);
  if (!codec) { opj_image_destroy(image); return -3; }
  opj_set_error_handler(codec, quiet, NULL); opj_set_warning_handler(codec, quiet, NULL); opj_set_info_handler(codec, quiet, NULL);
  if (!opj_setup_encoder(codec, &p, image)) { opj_destroy_codec(codec); opj_image_destroy(image); return -4; }
  Output out={0}; opj_stream_t *stream=opj_stream_create(65536, OPJ_FALSE);
  if (!stream) { opj_destroy_codec(codec); opj_image_destroy(image); return -3; }
  opj_stream_set_user_data(stream, &out, NULL); opj_stream_set_write_function(stream, write_output);
  opj_stream_set_skip_function(stream, skip_output); opj_stream_set_seek_function(stream, seek_output);
  OPJ_BOOL ok=opj_start_compress(codec,image,stream) && opj_encode(codec,stream) && opj_end_compress(codec,stream);
  opj_stream_destroy(stream); opj_destroy_codec(codec); opj_image_destroy(image);
  if (!ok || !out.length || out.length > UINT32_MAX) { free(out.data); return -5; }
  encoded=out.data; encoded_size=out.length;
  return 0;
}

static uint8_t scale8(const opj_image_comp_t *c, int32_t value) {
  const int64_t precision=(int64_t)c->prec;
  const int64_t range=(int64_t)1<<precision;
  const int64_t minimum=c->sgnd ? -(range>>1) : 0;
  const int64_t maximum=c->sgnd ? (range>>1)-1 : range-1;
  int64_t sample=value;
  if(sample<minimum) sample=minimum;
  if(sample>maximum) sample=maximum;
  const uint64_t normalized=(uint64_t)(sample-minimum);
  const uint64_t denominator=(uint64_t)(maximum-minimum);
  /* Round to nearest while mapping the declared component range to [0,255]. */
  return (uint8_t)((normalized*255u+denominator/2u)/denominator);
}
static int32_t sample_raw(const opj_image_comp_t *c, uint32_t x, uint32_t y, const opj_image_t *image) {
  int64_t sx=((int64_t)x + image->x0) / c->dx - c->x0;
  int64_t sy=((int64_t)y + image->y0) / c->dy - c->y0;
  if (sx<0) sx=0; if (sy<0) sy=0;
  if ((uint64_t)sx>=c->w) sx=c->w-1; if ((uint64_t)sy>=c->h) sy=c->h-1;
  return c->data[(uint64_t)sy*c->w+(uint64_t)sx];
}
static uint8_t sample8(const opj_image_comp_t *c, uint32_t x, uint32_t y, const opj_image_t *image) {
  return scale8(c,sample_raw(c,x,y,image));
}
static int32_t sample_sycc_chroma(const opj_image_comp_t *c, uint32_t x, uint32_t y,
                                  const opj_image_t *image) {
  uint32_t offx=c->dx==2 ? (image->x0&1u) : 0;
  uint32_t offy=c->dy==2 ? (image->y0&1u) : 0;
  if((offx && x==0) || (offy && y==0)) return 0;
  int64_t sx=c->dx==2 ? (x-offx)/2 : ((int64_t)x+image->x0)/c->dx-c->x0;
  int64_t sy=c->dy==2 ? (y-offy)/2 : ((int64_t)y+image->y0)/c->dy-c->y0;
  if(sx<0 || sy<0 || (uint64_t)sx>=c->w || (uint64_t)sy>=c->h) return 0;
  return c->data[(uint64_t)sy*c->w+(uint64_t)sx];
}

int jp2_decode(const uint8_t *bytes, uint32_t length, uint8_t **rgba_out, uint32_t generated) {
  decoded_width=decoded_height=0;
  uint32_t max_input=generated?MAX_GENERATED_INPUT:MAX_INPUT;
  if (!bytes || !rgba_out || length<4) return -1;
  if (length>max_input) return -5;
  *rgba_out=NULL;
  uint32_t cs_offset=0,cs_length=length;
  int box_status=jp2_unsupported_boxes(bytes,length,&cs_offset,&cs_length);
  if (box_status<0) return -3;
  if (box_status>0) return -4;
  int siz_status=preflight_siz(bytes+cs_offset,cs_length,max_input);
  if(siz_status<0) return -3;
  if(siz_status==1) return -5;
  if(siz_status==2) return -4;
  OPJ_CODEC_FORMAT format = (bytes[0]==0xff && bytes[1]==0x4f) ? OPJ_CODEC_J2K : OPJ_CODEC_JP2;
  Input in={bytes,length,0}; opj_dparameters_t p; opj_set_default_decoder_parameters(&p);
  opj_codec_t *codec=opj_create_decompress(format); if (!codec) return -2;
  opj_set_error_handler(codec,quiet,NULL); opj_set_warning_handler(codec,quiet,NULL); opj_set_info_handler(codec,quiet,NULL);
  if (!opj_setup_decoder(codec,&p) || !opj_decoder_set_strict_mode(codec, OPJ_TRUE)) { opj_destroy_codec(codec); return -2; }
  opj_stream_t *stream=opj_stream_create(65536,OPJ_TRUE);
  if (!stream) { opj_destroy_codec(codec); return -2; }
  opj_stream_set_user_data(stream,&in,NULL); opj_stream_set_user_data_length(stream,length);
  opj_stream_set_read_function(stream,read_input); opj_stream_set_skip_function(stream,skip_input); opj_stream_set_seek_function(stream,seek_input);
  opj_image_t *image=NULL;
  OPJ_BOOL ok=opj_read_header(stream,codec,&image);
  if (!ok || !image || image->x1<=image->x0 || image->y1<=image->y0) goto fail;
  uint32_t width=image->x1-image->x0, height=image->y1-image->y0;
  if (width>MAX_SIDE || height>MAX_SIDE || (uint64_t)width*height>MAX_PIXELS || image->numcomps<1 || image->numcomps>4) goto limit;
  if (image->icc_profile_len) goto unsupported;
  if (format==OPJ_CODEC_J2K && image->color_space==OPJ_CLRSPC_UNSPECIFIED) {
    if (image->numcomps==1) image->color_space=OPJ_CLRSPC_GRAY;
    else if (image->numcomps==3) image->color_space=OPJ_CLRSPC_SRGB;
    else goto fail;
  }
  uint32_t numcomps=image->numcomps;
  if (image->color_space!=OPJ_CLRSPC_SRGB && image->color_space!=OPJ_CLRSPC_GRAY && image->color_space!=OPJ_CLRSPC_SYCC) goto unsupported;
  uint32_t base_channels=image->color_space==OPJ_CLRSPC_GRAY?1:3;
  if(image->numcomps<base_channels || image->numcomps>base_channels+1) goto unsupported;
  int cdef_status=jp2_cdef_valid(bytes,length,numcomps,base_channels);
  if(cdef_status<0) goto fail;
  if(cdef_status>0) goto unsupported;
  for (uint32_t i=0;i<image->numcomps;i++) {
    opj_image_comp_t *c=&image->comps[i];
    if (!c->dx || !c->dy || !c->w || !c->h || c->prec<1 || c->prec>16 || c->w>MAX_SIDE || c->h>MAX_SIDE || (uint64_t)c->w*c->h>MAX_PIXELS) goto limit;
    uint64_t cx0=((uint64_t)image->x0+c->dx-1)/c->dx;
    uint64_t cy0=((uint64_t)image->y0+c->dy-1)/c->dy;
    uint64_t cx1=((uint64_t)image->x1+c->dx-1)/c->dx;
    uint64_t cy1=((uint64_t)image->y1+c->dy-1)/c->dy;
    if(c->x0!=cx0 || c->y0!=cy0 || c->w!=cx1-cx0 || c->h!=cy1-cy0) goto fail;
  }
  if(image->color_space==OPJ_CLRSPC_GRAY) {
    if(numcomps==2 && (image->comps[1].dx!=image->comps[0].dx || image->comps[1].dy!=image->comps[0].dy)) goto unsupported;
  } else if(image->color_space==OPJ_CLRSPC_SRGB) {
    for(uint32_t i=0;i<3;i++) if(image->comps[i].dx!=1 || image->comps[i].dy!=1) goto unsupported;
    if(numcomps==4 && (image->comps[3].dx!=1 || image->comps[3].dy!=1)) goto unsupported;
  } else {
    if(image->comps[0].dx!=1 || image->comps[0].dy!=1 ||
       image->comps[1].dx!=image->comps[2].dx || image->comps[1].dy!=image->comps[2].dy ||
       image->comps[1].dx>2 || image->comps[1].dy>2 ||
       (numcomps==4 && (image->comps[3].dx!=1 || image->comps[3].dy!=1))) goto unsupported;
    /* OpenJPEG's sYCC transform assumes equally precise unsigned Y/Cb/Cr. */
    for(uint32_t i=0;i<3;i++)
      if(image->comps[i].sgnd || image->comps[i].prec!=image->comps[0].prec) goto unsupported;
  }
  if(image->color_space==OPJ_CLRSPC_GRAY) {
    if(numcomps>2) goto unsupported;
  } else if(numcomps<3 || numcomps>4) goto unsupported;
  opj_codestream_info_v2_t *cstr=opj_get_cstr_info(codec);
  if (!cstr) goto fail;
  uint64_t tile_count=(uint64_t)cstr->tw*cstr->th;
  int tile_limit=!cstr->tw || !cstr->th || tile_count>MAX_TILES;
  opj_destroy_cstr_info(&cstr);
  if (tile_limit) goto limit;
  uint64_t working=width*(uint64_t)height*4;
  for(uint32_t i=0;i<image->numcomps;i++) working+=(uint64_t)image->comps[i].w*image->comps[i].h*8;
  if(working>MAX_DECODE_BYTES) goto limit;
  if (!opj_decode(codec,stream,image) || !opj_end_decompress(codec,stream)) goto fail;
  if(!image->comps || image->numcomps!=numcomps) goto fail;
  for(uint32_t c=0;c<image->numcomps;c++) if(!image->comps[c].data) goto fail;
  uint32_t ai=UINT32_MAX, alpha_count=0;
  for(uint32_t c=0;c<numcomps;c++) if(image->comps[c].alpha) { ai=c; alpha_count++; }
  if(alpha_count>1 || numcomps!=base_channels+(alpha_count?1:0) ||
     (alpha_count && ai!=numcomps-1)) goto unsupported;
  if (image->numcomps>4) goto fail;
  uint64_t count=(uint64_t)width*height;
  uint8_t *rgba=(uint8_t *)malloc(count*4);
  if (!rgba) goto fail;
  int gray=image->color_space==OPJ_CLRSPC_GRAY;
  for (uint32_t y=0;y<height;y++) for (uint32_t x=0;x<width;x++) {
    uint64_t o=((uint64_t)y*width+x)*4;
    if (gray) rgba[o]=rgba[o+1]=rgba[o+2]=sample8(&image->comps[0],x,y,image);
    else if (image->color_space==OPJ_CLRSPC_SYCC && image->numcomps>=3) {
      const opj_image_comp_t *ycomp=&image->comps[0];
      int precision=ycomp->prec;
      int offset=1<<(precision-1), maximum=(1<<precision)-1;
      int yy=sample_raw(ycomp,x,y,image);
      int cb=sample_sycc_chroma(&image->comps[1],x,y,image)-offset;
      int cr=sample_sycc_chroma(&image->comps[2],x,y,image)-offset;
      int r=yy+(int)(1.402f*cr), g=yy-(int)(0.344f*cb+0.714f*cr), b=yy+(int)(1.772f*cb);
      rgba[o]=scale8(ycomp,r<0?0:r>maximum?maximum:r);
      rgba[o+1]=scale8(ycomp,g<0?0:g>maximum?maximum:g);
      rgba[o+2]=scale8(ycomp,b<0?0:b>maximum?maximum:b);
    } else { rgba[o]=sample8(&image->comps[0],x,y,image); rgba[o+1]=sample8(&image->comps[1],x,y,image); rgba[o+2]=sample8(&image->comps[2],x,y,image); }
    rgba[o+3]=ai==UINT32_MAX?255:sample8(&image->comps[ai],x,y,image);
  }
  decoded_width=width; decoded_height=height; *rgba_out=rgba;
  opj_image_destroy(image); opj_stream_destroy(stream); opj_destroy_codec(codec); return 0;
fail:
  if (image) opj_image_destroy(image);
  opj_stream_destroy(stream); opj_destroy_codec(codec); return -3;
unsupported:
  if (image) opj_image_destroy(image);
  opj_stream_destroy(stream); opj_destroy_codec(codec); return -4;
limit:
  if (image) opj_image_destroy(image);
  opj_stream_destroy(stream); opj_destroy_codec(codec); return -5;
}
