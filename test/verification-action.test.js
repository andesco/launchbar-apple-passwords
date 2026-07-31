"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function pinActionContext() {
  const historyClears = [];
  const performedActions = [];
  const context = vm.createContext({
    LaunchBar: {
      execute(...args) {
        historyClears.push(args);
        return "";
      },
      log() {},
      performAction(...args) {
        performedActions.push(args);
      },
    },
  });

  vm.runInContext(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "Enter verification code.lbaction",
        "Contents",
        "Scripts",
        "default.js"
      ),
      "utf8"
    ),
    context
  );

  return { context, historyClears, performedActions };
}

test("the verification action forwards a complete code through the internal boundary", () => {
  const { context, historyClears, performedActions } = pinActionContext();

  context.run("482913");

  assert.deepEqual(performedActions, [
    ["Apple Passwords", "__apple_passwords_auth_response__:482913"],
  ]);
  assert.equal(historyClears.length, 2);
  assert.equal(
    historyClears[0][5],
    "ca.andrewlaunchbar.action.apple-passwords-pin"
  );
  assert.equal(historyClears[1][0], "/bin/sh");
});

test("the verification action rejects incomplete input on Return", () => {
  const { context, historyClears, performedActions } = pinActionContext();

  const results = context.run("123");

  assert.equal(results[0].title, "Invalid verification code");
  assert.equal(historyClears.length, 2);
  assert.deepEqual(performedActions, []);
});

test("both action inputs discard their old text when their work is done", () => {
  const root = path.join(__dirname, "..");
  const searchInfo = fs.readFileSync(
    path.join(root, "Apple Passwords.lbaction", "Contents", "Info.plist"),
    "utf8"
  );
  const verificationInfo = fs.readFileSync(
    path.join(root, "Enter verification code.lbaction", "Contents", "Info.plist"),
    "utf8"
  );

  assert.doesNotMatch(searchInfo, /LBKeepWindowActive/);
  assert.doesNotMatch(verificationInfo, /LBKeepWindowActive/);
  assert.match(searchInfo, /<string>Domain or hostname<\/string>/);
  assert.match(
    verificationInfo,
    /<string>Six-digit verification code shown by macOS<\/string>/
  );
});
