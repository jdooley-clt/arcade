const ACCENTS = new Set(["lavender", "mint", "coral"]);
const LAYOUTS = new Set(["document", "portrait"]);
const BUILT_WITH_KEYS = ["model", "tool", "creator", "notes", "link"];
const CREATOR_KEYS = ["name", "url"];

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function plainText(value, field) {
  const text = requiredText(value, field);
  if (/<\/?[a-z!?]/i.test(text) || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`${field} must be plain text without HTML tags or control characters.`);
  }
  return text;
}

function plainObject(value, field, allowedKeys, hint) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object ${hint}.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) {
    const list = allowedKeys.length > 2
      ? `${allowedKeys.slice(0, -1).join(", ")}, and ${allowedKeys.at(-1)}`
      : allowedKeys.join(" and ");
    throw new Error(`${field} has an unsupported key ${unknown.map((key) => `"${key}"`).join(", ")}; only ${list} are allowed.`);
  }
  return value;
}

// Provenance is optional and owner-populated; when present it must be complete enough to display.
function validateBuiltWith(value, base) {
  if (value === undefined) return null;
  const built = plainObject(value, "builtWith", BUILT_WITH_KEYS, "listing the model and/or tool that built the game");
  if (built.model === undefined && built.tool === undefined) {
    throw new Error("builtWith must include model or tool.");
  }
  let creator = null;
  if (built.creator !== undefined) {
    const person = plainObject(built.creator, "builtWith.creator", CREATOR_KEYS, "with a name and an optional HTTPS url");
    creator = {
      name: plainText(person.name, "builtWith.creator.name"),
      url: person.url === undefined ? null : resolveSafeUrl(person.url, base, "builtWith.creator.url", true)
    };
  }
  return {
    model: built.model === undefined ? null : plainText(built.model, "builtWith.model"),
    tool: built.tool === undefined ? null : plainText(built.tool, "builtWith.tool"),
    creator,
    notes: built.notes === undefined ? null : plainText(built.notes, "builtWith.notes"),
    link: built.link === undefined ? null : resolveSafeUrl(built.link, base, "builtWith.link", true)
  };
}

// Local paths resolve beside index.html, including GitHub Pages project subpaths.
export function resolveSafeUrl(value, base, field, remoteOnly = false) {
  const text = requiredText(value, field);
  const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(text);
  if (remoteOnly && !isAbsolute) throw new Error(`${field} must be an absolute HTTPS URL.`);
  if (text.startsWith("//") || text.includes("\\") || /[\u0000-\u0020]/.test(text)) {
    throw new Error(`${field} must be a relative path or an HTTPS URL without spaces.`);
  }
  const url = new URL(text, base);
  if (isAbsolute || remoteOnly) {
    if (url.protocol !== "https:") throw new Error(`${field} must use HTTPS.`);
  } else if (!["http:", "https:"].includes(url.protocol) || url.origin !== new URL(base).origin) {
    throw new Error(`${field} must resolve to a local HTTP(S) path.`);
  }
  if (url.username || url.password) throw new Error(`${field} must not contain credentials.`);
  return url.href;
}

export function validateCatalog(raw, base) {
  if (!Array.isArray(raw)) throw new Error("The game catalog must be an array.");
  const games = [];
  const errors = [];
  const ids = new Set();
  raw.forEach((entry, index) => {
    const label = `Game ${index + 1}`;
    try {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("entry must be an object.");
      }
      const id = requiredText(entry.id, "id");
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("id must be a lowercase slug.");
      if (ids.has(id)) throw new Error(`duplicate id "${id}".`);
      const title = requiredText(entry.title, "title");
      const description = requiredText(entry.description, "description");
      const instructions = requiredText(entry.instructions, "instructions");
      if (!Array.isArray(entry.controls) || entry.controls.length === 0) {
        throw new Error("controls must contain at least one key/action pair.");
      }
      const controls = entry.controls.map((control) => ({
        keys: requiredText(control?.keys, "control keys"),
        action: requiredText(control?.action, "control action")
      }));
      if (entry.viewport !== undefined && (!entry.viewport || typeof entry.viewport !== "object" || Array.isArray(entry.viewport))) {
        throw new Error("viewport must be an object when provided.");
      }
      const viewport = { layout: "document", height: 960, mobileHeight: 1100, ...entry.viewport };
      if (!LAYOUTS.has(viewport.layout)) throw new Error("viewport.layout must be document or portrait.");
      for (const field of ["height", "mobileHeight"]) {
        if (!Number.isInteger(viewport[field]) || viewport[field] < 320 || viewport[field] > 2400) {
          throw new Error(`viewport.${field} must be an integer between 320 and 2400.`);
        }
      }
      const accent = entry.accent ?? "lavender";
      if (!ACCENTS.has(accent)) throw new Error("accent must be lavender, mint or coral.");
      const game = {
        id, title, description, instructions, controls, viewport, accent,
        category: entry.category === undefined ? "Arcade game" : requiredText(entry.category, "category"),
        url: resolveSafeUrl(entry.url, base, "url"),
        repository: resolveSafeUrl(entry.repository, base, "repository", true),
        art: resolveSafeUrl(entry.art, base, "art"),
        coverArt: entry.coverArt === undefined ? null : resolveSafeUrl(entry.coverArt, base, "coverArt"),
        coverCharacter: entry.coverCharacter === undefined ? null : resolveSafeUrl(entry.coverCharacter, base, "coverCharacter"),
        builtWith: validateBuiltWith(entry.builtWith, base)
      };
      ids.add(id);
      games.push(game);
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  });
  return { games, errors };
}

export function gameFromHash(hash) {
  if (hash === "" || hash === "#" || hash === "#library") return { id: null };
  const match = /^#game\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(hash);
  return match ? { id: match[1] } : { error: "That game link is not valid. Choose a game below." };
}
