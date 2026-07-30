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
  const commandURLs = [];
  const pasted = [];
  const performedActions = [];
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
        throw new Error(`Unexpected APW command: ${command}`);
      },
      performAction(name) {
        performedActions.push(name);
      },
      openCommandURL(url) {
        commandURLs.push(url);
      },
      hide() {
        throw new Error("LaunchBar.hide() must not be called before paste");
      },
      paste(value) {
        pasted.push(value);
      },
      displayNotification() {},
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
    commandURLs,
    context,
    pasted,
    performedActions,
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
      ["admin", "admin.example.com", "Password + OTP"],
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

test("a password is fetched only after its field is chosen", () => {
  const { calls, context, pasted } = actionContext();
  const account = context.run("example.com")[1].actionArgument;

  context.pastePassword(account);

  assert.deepEqual(apwArguments(calls.at(-1)), [
    "pw",
    "get",
    "admin.example.com",
    "admin",
  ]);
  assert.deepEqual(pasted, ["secret"]);
});

test("a single account opens its available fields immediately", () => {
  const { context } = actionContext();
  const originalMergeEntries = context.mergeEntries;
  context.mergeEntries = (...args) => [originalMergeEntries(...args)[0]];

  const results = context.run("example.com");

  assert.deepEqual(
    Array.from(results, (result) => [result.title, result.subtitle]),
    [
      ["root", "Username"],
      ["Password", "example.com"],
    ]
  );
});

test("a later fragment search uses locally indexed domain metadata", () => {
  const { calls, context } = actionContext();
  context.run("example.com");
  const callCountAfterExactLookup = calls.length;

  const results = context.run("admin");

  assert.equal(results[0].title, "admin");
  assert.equal(results[0].subtitle, "Username");
  assert.equal(calls.length, callCountAfterExactLookup);
});

test("invalid URL input never invokes APW", () => {
  const { calls, context } = actionContext();
  const results = context.run("https://example.com/login");

  assert.equal(results[0].title, "Invalid search");
  assert.equal(calls.length, 0);
});

test("an invalid APW session authenticates and retries the lookup", () => {
  let lookupAttempts = 0;
  const { calls, context, performedActions } = actionContext({
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
  assert.equal(initialResult, undefined);
  assert.deepEqual(performedActions, ["Apple Passwords"]);

  const results = context.run("482913");
  assert.equal(results[0].title, "root");
  assert.deepEqual(calls.map(apwArguments), [
    ["pw", "list", "example.com"],
    ["auth", "request"],
    ["auth", "response", "--pin", "482913"],
    ["pw", "list", "example.com"],
    ["otp", "list", "example.com"],
  ]);
});

test("secret retrieval authenticates and retries before pasting", () => {
  let passwordAttempts = 0;
  const { calls, context, pasted, performedActions } = actionContext({
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

  const passwordField = context.run("example.com").find(
    (result) => result.title === "Password"
  );
  context.pastePassword(passwordField.actionArgument);

  assert.deepEqual(performedActions, ["Apple Passwords"]);
  assert.deepEqual(pasted, []);

  context.run("482913");

  assert.deepEqual(pasted, ["secret"]);
  assert.deepEqual(calls.map(apwArguments).slice(-4), [
    ["pw", "get", "example.com", "root"],
    ["auth", "request"],
    ["auth", "response", "--pin", "482913"],
    ["pw", "get", "example.com", "root"],
  ]);
});

test("an incomplete PIN keeps the pending authentication available", () => {
  const { calls, context, performedActions } = actionContext({
    apwResponse(args) {
      if (args.join(" ") === "auth request") return { status: 0 };
      return { status: 9, error: "Invalid session" };
    },
  });

  assert.equal(context.run("example.com"), undefined);
  const results = context.run("123");

  assert.equal(results[0].title, "Invalid APW PIN");
  assert.deepEqual(performedActions, ["Apple Passwords"]);
  assert.ok(context.Action.preferences.pendingAuthentication);
  assert.deepEqual(calls.map(apwArguments), [
    ["pw", "list", "example.com"],
    ["auth", "request"],
  ]);
});

test("a new domain abandons a pending authentication and starts a new lookup", () => {
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

  assert.equal(context.run("example.com"), undefined);
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

test("an unavailable daemon does not prompt for a PIN", () => {
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
