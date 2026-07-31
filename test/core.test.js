"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  bestDomain,
  domainFromValue,
  filterIndex,
  isCompleteDomain,
  mergeIndex,
  mergeEntries,
  normalizeQuery,
  normalizeTypedDomain,
  relationshipRank,
  selectSecretEntry,
} = require("../Apple Passwords.lbaction/Contents/Scripts/core.js");

test("normalizes a typed domain", () => {
  assert.equal(normalizeTypedDomain(" Accounts.Example.COM. "), "accounts.example.com");
  assert.equal(normalizeTypedDomain("xn--bcher-kva.example"), "xn--bcher-kva.example");
});

test("accepts partial domain text as a query", () => {
  assert.equal(normalizeQuery(" RedFlag "), "redflag");
  assert.equal(isCompleteDomain("redflag"), false);
  assert.equal(isCompleteDomain("redflagdeals.com"), true);
});

test("rejects URLs and incomplete hosts", () => {
  assert.throws(() => normalizeTypedDomain("https://example.com"), /only a domain/);
  assert.throws(() => normalizeTypedDomain("example.com/login"), /only a domain/);
  assert.throws(() => normalizeTypedDomain("localhost"), /complete domain/);
});

test("extracts domains from APW site values", () => {
  assert.equal(
    domainFromValue("https://login.Example.com:443/account?id=1"),
    "login.example.com"
  );
});

test("ranks exact, subdomain, and parent-domain matches", () => {
  assert.equal(relationshipRank("example.com", "example.com"), 0);
  assert.equal(relationshipRank("login.example.com", "example.com"), 1);
  assert.equal(relationshipRank("example.com", "login.example.com"), 2);
  assert.equal(relationshipRank("unrelated.test", "example.com"), 5);
  assert.equal(
    bestDomain(["www.example.com", "example.com"], "example.com"),
    "example.com"
  );
});

test("merges exact password and OTP identities while preserving subdomains", () => {
  const records = mergeEntries(
    [
      {
        username: "andrew@example.com",
        domain: "https://login.example.com/path",
        sites: ["https://login.example.com", "https://example.com"],
      },
      {
        username: "admin",
        domain: "admin.example.com",
        sites: ["admin.example.com"],
      },
    ],
    [
      { username: "andrew@example.com", domain: "example.com" },
      { username: "admin", domain: "admin.example.com" },
    ],
    "example.com"
  );

  assert.deepEqual(
    records.map((record) => [
      record.username,
      record.domain,
      record.hasPassword,
      record.hasOtp,
    ]),
    [
      ["andrew@example.com", "example.com", true, true],
      ["admin", "admin.example.com", true, true],
    ]
  );
});

test("sorts exact matches before subdomains", () => {
  const records = mergeEntries(
    [
      { username: "sub", domain: "login.example.com" },
      { username: "root", domain: "example.com" },
    ],
    [],
    "example.com"
  );
  assert.deepEqual(
    records.map((record) => record.username),
    ["root", "sub"]
  );
});

test("selects the fetched secret matching username and domain", () => {
  const selected = selectSecretEntry(
    [
      {
        username: "admin",
        domain: "other.example.com",
        password: "wrong",
      },
      {
        username: "admin",
        domain: "admin.example.com",
        password: "right",
      },
    ],
    {
      username: "admin",
      domain: "admin.example.com",
      sites: ["admin.example.com"],
    }
  );
  assert.equal(selected.password, "right");
});

test("indexes metadata and finds partial domain matches", () => {
  const index = mergeIndex([], [
    {
      username: "one",
      domain: "redflagdeals.com",
      sites: ["redflagdeals.com"],
      hasPassword: true,
      hasOtp: false,
    },
    {
      username: "two",
      domain: "example.redflagdeals.ca",
      sites: ["example.redflagdeals.ca"],
      hasPassword: true,
      hasOtp: true,
    },
    {
      username: "three",
      domain: "goredflag.net",
      sites: ["goredflag.net"],
      hasPassword: true,
      hasOtp: false,
    },
  ]);

  assert.deepEqual(
    filterIndex(index, "redflag").map((record) => record.domain),
    [
      "example.redflagdeals.ca",
      "redflagdeals.com",
      "goredflag.net",
    ]
  );
});
