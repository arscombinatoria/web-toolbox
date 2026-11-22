type ImageContext = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect' | 'drawImage'>;

export function drawOnWhite(context: ImageContext, image: ImageBitmap): void {
  context.fillStyle = '#fff';
  context.fillRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);
}
