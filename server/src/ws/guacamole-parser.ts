/** Minimal Guacamole protocol parser (subset of apache guacamole-client Parser). */

export function toInstruction(
  elements: (string | number | string[] | null | undefined)[]
): string {
  const parts = elements.map((value) => {
    if (Array.isArray(value)) {
      const str = value.join(",");
      return `${codePointCount(str)}.${str}`;
    }
    const str = value === null || value === undefined ? "" : String(value);
    return `${codePointCount(str)}.${str}`;
  });
  return `${parts.join(",")};`;
}

function codePointCount(str: string): number {
  const pairs = str.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g);
  return str.length - (pairs ? pairs.length : 0);
}

export class GuacamoleParser {
  private buffer = "";
  private elementBuffer: string[] = [];
  private elementEnd = -1;
  private startIndex = 0;
  private elementCodepoints = 0;

  oninstruction: ((opcode: string, params: string[]) => void) | null = null;

  receive(packet: string): void {
    if (this.buffer.length) this.buffer += packet;
    else this.buffer = packet;

    while (this.elementEnd < this.buffer.length) {
      if (this.elementEnd >= this.startIndex) {
        const codepoints = codePointCount(
          this.buffer.substring(this.startIndex, this.elementEnd)
        );
        if (codepoints < this.elementCodepoints) {
          this.elementEnd += this.elementCodepoints - codepoints;
          continue;
        }

        const element = this.buffer.substring(this.startIndex, this.elementEnd);
        const terminator = this.buffer.substring(this.elementEnd, this.elementEnd + 1);
        this.elementBuffer.push(element);

        if (terminator === ";") {
          const opcode = this.elementBuffer.shift() ?? "";
          this.oninstruction?.(opcode, [...this.elementBuffer]);
          this.elementBuffer = [];
          if (this.elementEnd + 1 === this.buffer.length) {
            this.elementEnd = -1;
            this.buffer = "";
          }
        } else if (terminator !== ",") {
          throw new Error("Invalid Guacamole instruction terminator");
        }

        this.startIndex = this.elementEnd + 1;
      }

      const lengthEnd = this.buffer.indexOf(".", this.startIndex);
      if (lengthEnd === -1) {
        this.startIndex = this.buffer.length;
        break;
      }

      this.elementCodepoints = parseInt(
        this.buffer.substring(this.elementEnd + 1, lengthEnd),
        10
      );
      if (Number.isNaN(this.elementCodepoints)) {
        throw new Error("Invalid Guacamole element length");
      }

      this.startIndex = lengthEnd + 1;
      this.elementEnd = this.startIndex + this.elementCodepoints;
    }
  }
}
