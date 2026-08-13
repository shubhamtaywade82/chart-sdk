import type { ScriptType } from "./types";

export interface TranspileResult {
  jsCode: string;
  type: ScriptType;
  title: string;
  overlay: boolean;
  version: number;
  inputs: { id: string; name: string; type: string; defaultValue: any }[];
}

const CONSTANT_MAP: Record<string, string> = {
  "color.blue": '"#2962FF"',
  "color.red": '"#FF495C"',
  "color.green": '"#00F5A0"',
  "color.purple": '"#A855F7"',
  "color.yellow": '"#FFD700"',
  "color.orange": '"#FFA726"',
  "color.aqua": '"#00E5FF"',
  "color.white": '"#FFFFFF"',
  "color.black": '"#000000"',
  "color.gray": '"#787B86"',
  "color.teal": '"#00B4D8"',
  "shape.triangleup": '"triangleup"',
  "shape.triangledown": '"triangledown"',
  "shape.circle": '"circle"',
  "shape.cross": '"cross"',
  "shape.arrowup": '"arrowup"',
  "shape.arrowdown": '"arrowdown"',
  "location.belowbar": '"belowbar"',
  "location.abovebar": '"abovebar"',
  "location.top": '"top"',
  "location.bottom": '"bottom"',
};

const splitArgs = (str: string): string[] => {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== "\\")) {
      if (inQuotes && char === quoteChar) {
        inQuotes = false;
      } else if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      }
    }
    if (char === "," && !inQuotes) {
      args.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
};

const transformNamedArgsInCalls = (line: string): string => {
  return line.replace(/\b(plot|plotshape|hline|strategy\.\w+)\s*\(([^)]+)\)/g, (_, fnName, argsStr) => {
    const parts = splitArgs(argsStr);
    const positionals: string[] = [];
    const named: string[] = [];

    for (const part of parts) {
      const trimmed = part.trim();
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0 && !trimmed.startsWith("==") && !trimmed.startsWith("!=")) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        named.push(`${key}: ${val}`);
      } else {
        positionals.push(trimmed);
      }
    }

    if (named.length === 0) {
      return `${fnName}(${argsStr})`;
    }

    const allArgs = [...positionals, `{ ${named.join(", ")} }`];
    return `${fnName}(${allArgs.join(", ")})`;
  });
};

export const transpilePineToJs = (pineCode: string): TranspileResult => {
  let title = "Custom Script";
  let type: ScriptType = "indicator";
  let overlay = true;
  let version = 6;
  const inputs: { id: string; name: string; type: string; defaultValue: any }[] = [];
  const declaredVars = new Set<string>();

  const lines = pineCode.split("\n");
  const processedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let rawLine = lines[i];
    let line = rawLine.trim();

    if (!line) continue;

    // Directives: version tag e.g. //@version=6 or //@version=5
    if (line.startsWith("//@version")) {
      const vMatch = line.match(/@version\s*=\s*(\d+)/);
      if (vMatch) version = parseInt(vMatch[1], 10);
      continue;
    }

    // Skip comments
    if (line.startsWith("//")) continue;

    // Directives: indicator(...) or strategy(...)
    if (line.startsWith("indicator(") || line.startsWith("strategy(")) {
      const isStrategy = line.startsWith("strategy(");
      type = isStrategy ? "strategy" : "indicator";

      const titleMatch = line.match(/(?:indicator|strategy)\(\s*["']([^"']+)["']/);
      if (titleMatch) title = titleMatch[1];

      const overlayMatch = line.match(/overlay\s*=\s*(true|false)/);
      if (overlayMatch) overlay = overlayMatch[1] === "true";
      continue;
    }

    // Replace constant keywords
    for (const [pineConstant, jsValue] of Object.entries(CONSTANT_MAP)) {
      line = line.split(pineConstant).join(jsValue);
    }

    // Replace Pine v6 logical operators: and -> &&, or -> ||, not -> !
    line = line.replace(/\band\b/g, "&&").replace(/\bor\b/g, "||").replace(/\bnot\s+/g, "!");

    // Replace series lag indexing e.g. close[1] -> _lag(close, 1)
    line = line.replace(/(\b[a-zA-Z_]\w*)\s*\[\s*(\d+)\s*\]/g, "_lag($1, $2)");

    // Transform input(...) / input.int(...) / input.float(...) declarations
    const inputMatch = line.match(/(?:var\s+)?([a-zA-Z_]\w*)\s*=\s*input(?:\.[a-zA-Z_]+)?\(([^)]+)\)/);
    if (inputMatch) {
      const varName = inputMatch[1];
      const args = inputMatch[2].split(",").map((s) => s.trim());
      const defValRaw = args[0];
      const titleArg = args[1] ? args[1].replace(/["']/g, "") : varName;

      let defVal: any = parseFloat(defValRaw);
      let inputType = "float";
      if (isNaN(defVal)) {
        if (defValRaw === "true" || defValRaw === "false") {
          defVal = defValRaw === "true";
          inputType = "bool";
        } else {
          defVal = defValRaw.replace(/["']/g, "");
          inputType = "string";
        }
      } else if (Number.isInteger(defVal)) {
        inputType = "int";
      }

      inputs.push({ id: varName, name: titleArg, type: inputType, defaultValue: defVal });
      declaredVars.add(varName);
      processedLines.push(`const ${varName} = inputs["${varName}"] !== undefined ? inputs["${varName}"] : ${defValRaw};`);
      continue;
    }

    // Clean up var / varip keyword
    if (line.startsWith("var ") || line.startsWith("varip ")) {
      line = line.replace(/^(var|varip)\s+/, "").trim();
    }

    // Transform named args in function calls e.g. plot(x, color=...) -> plot(x, { color: ... })
    line = transformNamedArgsInCalls(line);

    // Replace := with =
    line = line.replace(/:=/g, "=");

    // Handle Tuple destructuring e.g. [a, b, c] = ta.macd(...)
    const tupleMatch = line.match(/^\[\s*([^\]]+)\s*\]\s*=\s*(.+)$/);
    if (tupleMatch) {
      const vars = tupleMatch[1].split(",").map((v) => v.trim());
      vars.forEach((v) => declaredVars.add(v));
      processedLines.push(`let [${vars.join(", ")}] = ${tupleMatch[2]};`);
      continue;
    }

    // Handle single variable assignment e.g. fastEMA = ta.ema(...)
    const assignMatch = line.match(/^([a-zA-Z_]\w*)\s*=\s*(.+)$/);
    if (assignMatch && !line.startsWith("if ") && !line.startsWith("for ") && !line.startsWith("while ")) {
      const varName = assignMatch[1];
      if (!declaredVars.has(varName)) {
        declaredVars.add(varName);
        line = `let ${varName} = ${assignMatch[2]};`;
      }
    }

    // Handle single-line if statement block from Pine Script indentation
    if (line.startsWith("if ") && !line.endsWith("{") && i + 1 < lines.length) {
      const nextRaw = lines[i + 1];
      if (nextRaw.startsWith("    ") || nextRaw.startsWith("\t")) {
        const nextLine = transformNamedArgsInCalls(nextRaw.trim());
        line = `${line} { ${nextLine} }`;
        i++;
      }
    }

    processedLines.push(line);
  }

  const jsBody = processedLines.join("\n");

  return {
    jsCode: jsBody,
    type,
    title,
    overlay,
    version,
    inputs,
  };
};
