"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function apwArguments(call) {
  return call[0] === "/bin/sh" ? call.slice(5) : call.slice(1);
}

function actionContext(options = {}) {
  const scripts = path.join(
    __dirname,
    "..",
    "Apple Passwords.lbaction",
    "Contents",
    "Scripts"
  );
  const calls = [];
  const clipboardStrings = [];
  const commandURLs = [];
  const handoffCommands = [];
  const hides = [];
  const historyClears = [];
  const largeTypeDisplays = [];
  const notifications = [];
  const pasted = [];
  const performedActions = [];
  const scriptCalls = [];
  let storedIndex = [];
  const context = vm.createContext({
    console,
    include() {},
    File: {
      exists(candidate) {
        return candidate === "/opt/homebrew/bin/apw";
      },
      readJSON() {
        return storedIndex;
      },
      writeJSON(value) {
        storedIndex = value;
      },
    },
    Action: {
      preferences: {},
      supportPath: "/tmp/apple-passwords-launchbar-test",
    },
    LaunchBar: {
      execute(...args) {
        if (args[0] === "/usr/bin/defaults") {
          historyClears.push(args);
          return "";
        }
        if (
          args[0] === "/bin/sh" &&
          args[1] === "-c" &&
          String(args[2]).includes("osascript")
        ) {
          handoffCommands.push(args);
          return "";
        }
        calls.push(args);
        const apwArgs = apwArguments(args);
        if (options.apwResponse) {
          const response = options.apwResponse(apwArgs, calls.length);
          return typeof response === "string"
            ? response
            : JSON.stringify(response);
        }

        const command = apwArgs.join(" ");
        if (command === "pw list example.com") {
          return JSON.stringify({
            status: 0,
            results: [
              {
                username: "root",
                domain: "example.com",
                sites: ["example.com"],
              },
              {
                username: "admin",
                domain: "admin.example.com",
                sites: ["admin.example.com"],
              },
            ],
          });
        }
        if (command === "otp list example.com") {
          return JSON.stringify({
            status: 0,
            results: [{ username: "admin", domain: "admin.example.com" }],
          });
        }
        if (command === "pw list admin.example.com") {
          return JSON.stringify({
            status: 0,
            results: [
              {
                username: "admin",
                domain: "admin.example.com",
                sites: ["admin.example.com"],
              },
            ],
          });
        }
        if (command === "pw get admin.example.com admin") {
          return JSON.stringify({
            status: 0,
            results: [
              {
                username: "admin",
                domain: "admin.example.com",
                password: "secret",
              },
            ],
          });
        }
        if (command === "otp get admin.example.com") {
          return JSON.stringify({
            status: 0,
            results: [
              {
                username: "admin",
                domain: "admin.example.com",
                source: "totp",
                code: "654321",
              },
            ],
          });
        }
        if (command === "pw get example.com root") {
          return JSON.stringify({
            status: 0,
            results: [
              {
                username: "root",
                domain: "example.com",
                password: "rootsecret",
              },
            ],
          });
        }
        throw new Error(`Unexpected APW command: ${command}`);
      },
      performAction(...args) {
        performedActions.push(args);
      },
      executeAppleScript(...lines) {
        scriptCalls.push(lines);
      },
      openCommandURL(url) {
        commandURLs.push(url);
      },
      hide() {
        hides.push(true);
      },
      paste(value) {
        pasted.push(value);
      },
      setClipboardString(value) {
        clipboardStrings.push(value);
      },
      displayInLargeType(displayData) {
        largeTypeDisplays.push(displayData);
      },
      displayNotification(notification) {
        notifications.push(notification);
      },
      log() {},
    },
  });

  vm.runInContext(
    fs.readFileSync(path.join(scripts, "core.js"), "utf8"),
    context
  );
  vm.runInContext(
    fs.readFileSync(path.join(scripts, "default.js"), "utf8"),
    context
  );
  return {
    calls,
    clipboardStrings,
    commandURLs,
    context,
    handoffCommands,
    hides,
    historyClears,
    largeTypeDisplays,
    notifications,
    pasted,
    performedActions,
    scriptCalls,
  };
}

test("the action lists exact and subdomain matches without fetching secrets", () => {
  const { calls, context } = actionContext();
  const results = context.run("example.com");

  assert.deepEqual(
    Array.from(results, (result) => [
      result.title,
      result.subtitle,
      result.badge,
    ]),
    [
      ["root", "example.com", "Password"],
      ["admin", "admin.example.com", "Password + Verification code"],
    ]
  );
  assert.deepEqual(
    calls.map(apwArguments),
    [
      ["pw", "list", "example.com"],
      ["otp", "list", "example.com"],
    ]
  );
});

test("selecting an account shows its fields instantly, without calling APW", () => {
  const { calls, context } = actionContext();
  const accountItem = context.run("example.com")[1];
  const callsBeforeSelection = calls.length;

  const fields = context.showFields(accountItem.actionArgument);

  assert.equal(calls.length, callsBeforeSelection);
  assert.deepEqual(
    Array.from(fields, (field) => [field.title, field.action, field.actionReturnsItems]),
    [
      ["admin", "pasteUsername", undefined],
      ["Paste password", "fetchAndPastePassword", true],
      ["Paste verification code", "fetchAndPasteOtp", true],
      ["Copy password", "copyPassword", true],
      ["Copy verification code", "copyOtp", true],
      ["admin.example.com", undefined, undefined],
    ]
  );
});

test("pasting the password fetches and pastes it in one step, without revealing it", () => {
  const { calls, context, pasted } = actionContext();
  const accountItem = context.run("example.com")[1];
  const fields = context.showFields(accountItem.actionArgument);

  const result = context.fetchAndPastePassword(fields[1].actionArgument);

  assert.deepEqual(calls.slice(-1).map(apwArguments)[0], [
    "pw",
    "get",
    "admin.example.com",
    "admin",
  ]);
  assert.deepEqual(pasted, ["secret"]);
  assert.equal(result, undefined);
});

test("pasting the verification code fetches and pastes it in one step, without revealing it", () => {
  const { calls, context, pasted } = actionContext();
  const accountItem = context.run("example.com")[1];
  const fields = context.showFields(accountItem.actionArgument);

  const result = context.fetchAndPasteOtp(fields[2].actionArgument);

  assert.deepEqual(calls.slice(-1).map(apwArguments)[0], [
    "otp",
    "get",
    "admin.example.com",
  ]);
  assert.deepEqual(pasted, ["654321"]);
  assert.equal(result, undefined);
});

test("copying the password fetches only that secret, once, and puts it on the clipboard silently", () => {
  const { calls, clipboardStrings, context, largeTypeDisplays } = actionContext();
  const accountItem = context.run("example.com")[1];
  const fields = context.showFields(accountItem.actionArgument);
  const callsBeforeCopy = calls.length;

  const result = context.copyPassword(fields[3].actionArgument);

  assert.deepEqual(calls.slice(callsBeforeCopy).map(apwArguments), [
    ["pw", "get", "admin.example.com", "admin"],
  ]);
  assert.equal(result, undefined);
  assert.deepEqual(clipboardStrings, ["secret"]);
  assert.equal(largeTypeDisplays.length, 0);
});

test("copying the verification code fetches only that secret, once, and puts it on the clipboard silently", () => {
  const { calls, clipboardStrings, context, largeTypeDisplays } = actionContext();
  const accountItem = context.run("example.com")[1];
  const fields = context.showFields(accountItem.actionArgument);
  const callsBeforeCopy = calls.length;

  const result = context.copyOtp(fields[4].actionArgument);

  assert.deepEqual(calls.slice(callsBeforeCopy).map(apwArguments), [
    ["otp", "get", "admin.example.com"],
  ]);
  assert.equal(result, undefined);
  assert.deepEqual(clipboardStrings, ["654321"]);
  assert.equal(largeTypeDisplays.length, 0);
});

test("a single account opens its available fields immediately, without calling APW", () => {
  const { calls, context } = actionContext();
  const originalMergeEntries = context.mergeEntries;
  context.mergeEntries = (...args) => [originalMergeEntries(...args)[0]];

  const results = context.run("example.com");

  assert.deepEqual(
    Array.from(results, (result) => [result.title, result.subtitle]),
    [
      ["root", "Username"],
      ["Paste password", "example.com"],
      ["Copy password", "example.com"],
      ["example.com", "Associated domain"],
    ]
  );
  assert.deepEqual(calls.map(apwArguments), [
    ["pw", "list", "example.com"],
    ["otp", "list", "example.com"],
  ]);
});

test("all associated domains appear as their own field, including the primary domain, without calling APW", () => {
  const { calls, context } = actionContext({
    apwResponse(args) {
      const command = args.join(" ");
      if (command === "pw list example.com") {
        return {
          status: 0,
          results: [
            {
              username: "root",
              domain: "example.com",
              sites: ["example.com", "www.example.com", "login.example.com"],
            },
          ],
        };
      }
      if (command === "otp list example.com") return { status: 0, results: [] };
      throw new Error(`Unexpected APW command: ${command}`);
    },
  });

  const results = context.run("example.com");
  const domainItems = results.filter(
    (result) => result.subtitle === "Associated domain"
  );

  assert.deepEqual(
    Array.from(domainItems, (item) => [item.title, item.url]),
    [
      ["example.com", "https://example.com"],
      ["www.example.com", "https://www.example.com"],
      ["login.example.com", "https://login.example.com"],
    ]
  );
  assert.deepEqual(calls.map(apwArguments), [
    ["pw", "list", "example.com"],
    ["otp", "list", "example.com"],
  ]);
});

test("a later partial search uses locally indexed domain metadata", () => {
  const { calls, context } = actionContext();
  context.run("example.com");
  const callCountAfterExactLookup = calls.length;

  const results = context.run("admin");

  assert.equal(results[0].title, "admin");
  assert.equal(results[0].subtitle, "Username");
  assert.equal(calls.length, callCountAfterExactLookup + 1);
  assert.deepEqual(apwArguments(calls.at(-1)), [
    "pw",
    "list",
    "admin.example.com",
  ]);
});

test("a partial search requests authentication before showing indexed secrets", () => {
  let unpaired = false;
  const { calls, context } = actionContext({
    apwResponse(args) {
      const command = args.join(" ");
      if (command === "pw list example.com" && !unpaired) {
        return {
          status: 0,
          results: [
            {
              username: "admin",
              domain: "admin.example.com",
              sites: ["admin.example.com"],
            },
          ],
        };
      }
      if (command === "otp list example.com" && !unpaired) {
        return {
          status: 0,
          results: [
            { username: "admin", domain: "admin.example.com" },
          ],
        };
      }
      if (command === "pw list admin.example.com" && unpaired) {
        return { status: 9, error: "Invalid session" };
      }
      if (command === "auth request") return { status: 0 };
      throw new Error(`Unexpected APW command: ${command}`);
    },
  });

  context.run("example.com");
  unpaired = true;
  const results = context.run("admin");

  assert.equal(results[0].title, "Enter verification code");
  assert.equal(
    context.Action.preferences.pendingAuthentication.resume.query,
    "admin"
  );
  assert.deepEqual(calls.map(apwArguments).slice(-2), [
    ["pw", "list", "admin.example.com"],
    ["auth", "request"],
  ]);
});

test("invalid URL input never invokes APW", () => {
  const { calls, context } = actionContext();
  const results = context.run("https://example.com/login");

  assert.equal(results[0].title, "Invalid search");
  assert.equal(calls.length, 0);
});

test("the verification action resumes the original lookup with an internal response", () => {
  let lookupAttempts = 0;
  const { calls, context, handoffCommands, historyClears, scriptCalls } =
    actionContext({
      apwResponse(args) {
        const command = args.join(" ");
        if (command === "pw list example.com" && lookupAttempts++ === 0) {
          return { status: 9, error: "Invalid session" };
        }
        if (command === "auth request") return { status: 0 };
        if (command === "auth response --pin 482913") return { status: 0 };
        if (command === "pw list example.com") {
          return {
            status: 0,
            results: [
              {
                username: "root",
                domain: "example.com",
                sites: ["example.com"],
              },
            ],
          };
        }
        if (command === "otp list example.com") {
          return { status: 0, results: [] };
        }
        throw new Error(`Unexpected APW command: ${command}`);
      },
    });

  const initialResult = context.run("example.com");
  assert.equal(
    initialResult[0].title,
    "Enter verification code"
  );
  assert.equal(
    initialResult[0].actionBundleIdentifier,
    "ca.andrewlaunchbar.action.apple-passwords-pin"
  );
  assert.equal(handoffCommands.length, 0);
  assert.equal(historyClears.length, 1);
  assert.equal(
    historyClears[0][5],
    "ca.andrewlaunchbar.action.apple-passwords-pin"
  );
  assert.equal(scriptCalls.length, 0);

  const typingResult = context.suggest("example.com482913");
  assert.deepEqual(Array.from(typingResult), []);
  assert.deepEqual(calls.map(apwArguments), [
    ["pw", "list", "example.com"],
    ["auth", "request"],
  ]);

  const results = context.run("__apple_passwords_auth_response__:482913");
  assert.equal(results[0].title, "root");
  assert.deepEqual(calls.map(apwArguments), [
    ["pw", "list", "example.com"],
    ["auth", "request"],
    ["auth", "response", "--pin", "482913"],
    ["pw", "list", "example.com"],
    ["otp", "list", "example.com"],
  ]);
});

test("the verification action resumes copying the secret silently", () => {
  let passwordAttempts = 0;
  const { calls, clipboardStrings, context, handoffCommands, largeTypeDisplays, pasted } = actionContext({
      apwResponse(args) {
        const command = args.join(" ");
        if (command === "pw list example.com") {
          return {
            status: 0,
            results: [
              {
                username: "root",
                domain: "example.com",
                sites: ["example.com"],
              },
            ],
          };
        }
        if (command === "otp list example.com") {
          return { status: 0, results: [] };
        }
        if (command === "pw get example.com root" && passwordAttempts++ === 0) {
          return { status: 9, error: "Invalid session" };
        }
        if (command === "auth request") return { status: 0 };
        if (command === "auth response --pin 482913") return { status: 0 };
        if (command === "pw get example.com root") {
          return {
            status: 0,
            results: [
              {
                username: "root",
                domain: "example.com",
                password: "secret",
              },
            ],
          };
        }
        throw new Error(`Unexpected APW command: ${command}`);
      },
    });

  const fields = context.run("example.com");
  const passwordField = fields.find((result) => result.title === "Copy password");
  const prompt = context.copyPassword(passwordField.actionArgument);

  assert.equal(prompt[0].title, "Enter verification code");
  assert.equal(
    prompt[0].actionBundleIdentifier,
    "ca.andrewlaunchbar.action.apple-passwords-pin"
  );
  assert.equal(handoffCommands.length, 0);
  assert.deepEqual(pasted, []);

  const result = context.run("__apple_passwords_auth_response__:482913");

  assert.equal(result, undefined);
  assert.deepEqual(clipboardStrings, ["secret"]);
  assert.equal(largeTypeDisplays.length, 0);
  assert.deepEqual(pasted, []);
  assert.deepEqual(calls.map(apwArguments).slice(-4), [
    ["pw", "get", "example.com", "root"],
    ["auth", "request"],
    ["auth", "response", "--pin", "482913"],
    ["pw", "get", "example.com", "root"],
  ]);
});

test("the verification action resumes a one-shot paste without ever revealing the value", () => {
  let passwordAttempts = 0;
  const { context, pasted } = actionContext({
    apwResponse(args) {
      const command = args.join(" ");
      if (command === "pw list example.com") {
        return {
          status: 0,
          results: [
            { username: "root", domain: "example.com", sites: ["example.com"] },
          ],
        };
      }
      if (command === "otp list example.com") {
        return { status: 0, results: [] };
      }
      if (command === "pw get example.com root" && passwordAttempts++ === 0) {
        return { status: 9, error: "Invalid session" };
      }
      if (command === "auth request") return { status: 0 };
      if (command === "auth response --pin 482913") return { status: 0 };
      if (command === "pw get example.com root") {
        return {
          status: 0,
          results: [
            { username: "root", domain: "example.com", password: "secret" },
          ],
        };
      }
      throw new Error(`Unexpected APW command: ${command}`);
    },
  });

  const fields = context.run("example.com");
  const pasteField = fields.find((result) => result.title === "Paste password");
  const prompt = context.fetchAndPastePassword(pasteField.actionArgument);

  assert.equal(prompt[0].title, "Enter verification code");
  assert.deepEqual(pasted, []);

  const result = context.run("__apple_passwords_auth_response__:482913");

  assert.deepEqual(pasted, ["secret"]);
  assert.equal(result, undefined);
});

test("suggestions only read the local index and never mutate authentication", () => {
  const { calls, context } = actionContext();
  context.run("example.com");
  const callsBeforeSuggestion = calls.length;
  const pending = {
    createdAt: Date.now(),
    resume: { type: "lookup", query: "example.com" },
  };
  context.Action.preferences.pendingAuthentication = pending;

  const suggestions = context.suggest("admin");

  assert.equal(suggestions[0].title, "admin.example.com");
  assert.equal(suggestions[0].subtitle, "admin");
  assert.equal(calls.length, callsBeforeSuggestion);
  assert.deepEqual(context.Action.preferences.pendingAuthentication, pending);
});

test("selecting a suggestion submits its domain instead of its account label", () => {
  const { calls, context } = actionContext({
    apwResponse(args) {
      const command = args.join(" ");
      if (command === "pw list andrewe.dev") {
        return {
          status: 0,
          results: [
            {
              username: "Jacket API token",
              domain: "andrewe.dev",
              sites: ["andrewe.dev"],
            },
          ],
        };
      }
      if (command === "otp list andrewe.dev") {
        return { status: 0, results: [] };
      }
      throw new Error(`Unexpected APW command: ${command}`);
    },
  });

  context.run("andrewe.dev");
  const callsBeforeSuggestion = calls.length;
  const suggestions = context.suggest("andrewe.dev");

  assert.equal(suggestions[0].title, "andrewe.dev");
  assert.equal(suggestions[0].subtitle, "Jacket API token");
  assert.equal(suggestions[0].action, undefined);
  assert.equal(calls.length, callsBeforeSuggestion);

  const results = context.run(suggestions[0].title);
  assert.equal(results[0].title, "Jacket API token");
  assert.equal(results[1].title, "Paste password");
});

test("a new search replaces stale authentication state instead of parsing it as a code", () => {
  const { calls, context } = actionContext({
    apwResponse(args) {
      const command = args.join(" ");
      if (command === "pw list example.com") {
        return { status: 9, error: "Invalid session" };
      }
      if (command === "auth request") return { status: 0 };
      if (command === "pw list other.test") {
        return {
          status: 0,
          results: [
            {
              username: "other",
              domain: "other.test",
              sites: ["other.test"],
            },
          ],
        };
      }
      if (command === "otp list other.test") {
        return { status: 0, results: [] };
      }
      throw new Error(`Unexpected APW command: ${command}`);
    },
  });

  assert.equal(
    context.run("example.com")[0].title,
    "Enter verification code"
  );
  const results = context.run("other.test");

  assert.equal(results[0].title, "other");
  assert.equal(context.Action.preferences.pendingAuthentication, null);
  assert.deepEqual(calls.map(apwArguments), [
    ["pw", "list", "example.com"],
    ["auth", "request"],
    ["pw", "list", "other.test"],
    ["otp", "list", "other.test"],
  ]);
});

test("an internal verification response requires a pending request", () => {
  const { calls, context } = actionContext();

  const results = context.run("__apple_passwords_auth_response__:482913");

  assert.equal(results[0].title, "Authentication request expired");
  assert.equal(calls.length, 0);
});

test("ordinary six-digit input is always treated as a search", () => {
  const { calls, context } = actionContext({
    apwResponse(args) {
      if (args.join(" ") === "auth request") return { status: 0 };
      return { status: 9, error: "Invalid session" };
    },
  });

  context.run("example.com");
  const results = context.run("482913");

  assert.equal(results[0].title, "No indexed matches");
  assert.equal(context.Action.preferences.pendingAuthentication, null);
  assert.deepEqual(calls.map(apwArguments), [
    ["pw", "list", "example.com"],
    ["auth", "request"],
  ]);
});

test("an unavailable daemon does not prompt for a verification code", () => {
  const { calls, context, performedActions } = actionContext({
    apwResponse() {
      return { status: 9, error: "Invalid session" };
    },
  });

  const results = context.run("example.com");

  assert.equal(results[0].title, "APW is unavailable");
  assert.match(results[0].subtitle, /service and browser extension/i);
  assert.equal(performedActions.length, 0);
  assert.deepEqual(calls.map(apwArguments), [
    ["pw", "list", "example.com"],
    ["auth", "request"],
  ]);
});
