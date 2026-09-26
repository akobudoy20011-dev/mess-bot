"use strict";

const path = require("path");

const RESIBO_PROFILES = Object.freeze([
  {
    name: "Hey Kez",
    url: "https://www.facebook.com/profile.php?id=61594666470377",
    image: path.join(__dirname, "resibo", "hey_kez.jpg"),
  },
  {
    name: "Sato Serused-møwd",
    url: "https://www.facebook.com/profile.php?id=61588685169649",
    image: path.join(__dirname, "resibo", "sato_serused_mowd.jpg"),
  },
  {
    name: "Kyrø Undéfêatéd",
    url: "https://www.facebook.com/profile.php?id=61590269465121",
    image: path.join(__dirname, "resibo", "kyro_undefeated.jpg"),
  },
]);

function getRandomResiboProfile() {
  if (!RESIBO_PROFILES.length) return null;
  return RESIBO_PROFILES[Math.floor(Math.random() * RESIBO_PROFILES.length)];
}

function getResiboImagePath(profile) {
  return profile && profile.image ? profile.image : null;
}

module.exports = {
  RESIBO_PROFILES,
  getRandomResiboProfile,
  getResiboImagePath,
};
