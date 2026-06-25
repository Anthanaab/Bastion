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

export function readInstruction(
  message: string,
  startIndex: number
): { opcode: string; params: string[]; raw: string; end: number } | null {
  let index = startIndex;
  const elements: string[] = [];
  let prevEnd = startIndex - 1;

  do {
    const lengthEnd = message.indexOf(".", index);
    if (lengthEnd === -1) return null;

    const length = parseInt(message.substring(prevEnd + 1, lengthEnd), 10);
    if (Number.isNaN(length)) return null;

    index = lengthEnd + 1;
    const elementEnd = index + length;
    if (elementEnd > message.length) return null;

    const element = message.substring(index, elementEnd);
    const terminator = message.substring(elementEnd, elementEnd + 1);
    elements.push(element);

    if (terminator === ";") {
      const opcode = elements.shift() ?? "";
      const rawEnd = elementEnd + 1;
      return {
        opcode,
        params: [...elements],
        raw: message.substring(startIndex, rawEnd),
        end: rawEnd,
      };
    }

    if (terminator !== ",") return null;
    prevEnd = elementEnd;
    index = elementEnd + 1;
  } while (index < message.length);

  return null;
}

/** Split tunnel keepalives (empty opcode) from instructions meant for guacd. */
export function splitClientMessage(message: string): {
  tunnelOnly: string;
  forGuacd: string;
  remainder: string;
} {
  const tunnelOnly: string[] = [];
  const forGuacd: string[] = [];
  let index = 0;

  while (index < message.length) {
    const instruction = readInstruction(message, index);
    if (!instruction) {
      return {
        tunnelOnly: tunnelOnly.join(""),
        forGuacd: forGuacd.join(""),
        remainder: message.slice(index),
      };
    }
    if (instruction.opcode.length === 0) {
      tunnelOnly.push(instruction.raw);
    } else {
      forGuacd.push(instruction.raw);
    }
    index = instruction.end;
  }

  return {
    tunnelOnly: tunnelOnly.join(""),
    forGuacd: forGuacd.join(""),
    remainder: "",
  };
}

/** @deprecated Use splitClientMessage — kept for compatibility */
export function filterInstructionsForGuacd(message: string): string {
  return splitClientMessage(message).forGuacd;
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

        if (
          this.elementCodepoints &&
          this.buffer.codePointAt(this.elementEnd - 1) !== undefined &&
          (this.buffer.codePointAt(this.elementEnd - 1) ?? 0) >= 0x10000
        ) {
          this.elementEnd++;
          continue;
        }

        const element = this.buffer.substring(this.startIndex, this.elementEnd);
        const terminator = this.buffer.substring(this.elementEnd, this.elementEnd + 1);
        this.elementBuffer.push(element);

        if (terminator === ";") {
          const opcode = this.elementBuffer.shift() ?? "";
          this.oninstruction?.(opcode, [...this.elementBuffer]);
          this.elementBuffer = [];

          if (this.elementEnd + 1 >= this.buffer.length) {
            this.elementEnd = -1;
            this.buffer = "";
            this.startIndex = 0;
            this.elementCodepoints = 0;
            break;
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
