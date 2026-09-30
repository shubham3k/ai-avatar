import { describe, expect, it } from "vitest";
import { isExplicitRememberRequest } from "./remember-intent.js";

describe("isExplicitRememberRequest", () => {
  it.each([
    "my name is shubham remembar that",
    "Remember that Rahul is my manager",
    "please note that I prefer calls after 11",
    "don't forget my wife's birthday is 3 March",
    "yaad rakhna ki Priya meri sister hai",
    "mera naam Shubham hai",
    "मेरा नाम शुभम है",
    "ये याद रखना",
    "call me Shubh",
  ])("saves: %s", (text) => {
    expect(isExplicitRememberRequest(text)).toBe(true);
  });

  it.each([
    "do you remember what I said yesterday?",
    "remember when we talked about the budget?",
    "kya tumhe yaad hai?",
    "remind me at 5 to call Rahul",
    "what's on my calendar?",
  ])("doesn't force a save: %s", (text) => {
    expect(isExplicitRememberRequest(text)).toBe(false);
  });
});
