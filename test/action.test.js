"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function actionContext() {
  const scripts = path.join(
    __dirname,
    "..",
    "Apple Passwords.lbaction",
    "Contents",
    "Scripts"
  );
  const calls = [];
  const pasted = [];
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
      supportPath: "/tmp/apple-passwords-launchbar-test",
    },
    LaunchBar: {
      execute(...args) {
        calls.push(args);
        const command = args.slice(1).join(" ");
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
  return { calls, context, pasted };
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
    calls.map((args) => args.slice(1)),
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

  assert.deepEqual(calls.at(-1).slice(1), [
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
