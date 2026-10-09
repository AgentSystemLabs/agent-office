// Safari places a line of canvas text that starts with some emoji (⌨️, 🏎️: the ones with a variation
// selector) half its width too far right when it's centred, and wrong when it's right-aligned, though
// it measures it right. So every centred or right-aligned line on a canvas is measured here and drawn
// left-aligned from where it should start, the same in every browser.

type Draw = (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) => void;

function aligned(draw: Draw): Draw {
  return function (text, x, y, maxWidth) {
    const align = this.textAlign;
    if (align === 'left' || align === 'start') return draw.call(this, text, x, y, maxWidth);
    let width = this.measureText(text).width;
    if (maxWidth !== undefined) width = Math.min(width, maxWidth);
    this.textAlign = 'left';
    draw.call(this, text, align === 'center' ? x - width / 2 : x - width, y, maxWidth);
    this.textAlign = align;
  };
}

if (typeof CanvasRenderingContext2D !== 'undefined') {
  const proto = CanvasRenderingContext2D.prototype;
  proto.fillText = aligned(proto.fillText);
  proto.strokeText = aligned(proto.strokeText);
}
