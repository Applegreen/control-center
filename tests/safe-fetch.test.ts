import assert from "node:assert/strict";
import test from "node:test";
import { isNonPublicIpAddress } from "../lib/server/public-address";

test("network source validation blocks non-public IPv4 address classes", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
  ]) assert.equal(isNonPublicIpAddress(address), true, address);
});

test("network source validation blocks mapped, local, special, and reserved IPv6", () => {
  for (const address of [
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "::ffff:0:7f00:1",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "fe90::1",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "100::1",
    "2001:db8::1",
    "3fff::1",
    "64:ff9b:1::1",
    "64:ff9b::127.0.0.1",
    "4000::1",
    "8000::1",
  ]) assert.equal(isNonPublicIpAddress(address), true, address);
});

test("network source validation allows ordinary public IP addresses", () => {
  for (const address of [
    "1.1.1.1",
    "8.8.8.8",
    "192.0.0.9",
    "::ffff:8.8.8.8",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "3fff:1000::1",
    "64:ff9b::8.8.8.8",
  ]) assert.equal(isNonPublicIpAddress(address), false, address);
});

test("network source validation fails closed for malformed addresses", () => {
  for (const address of ["", "not-an-ip", "999.1.1.1", "2001:::1"])
    assert.equal(isNonPublicIpAddress(address), true, address);
});
