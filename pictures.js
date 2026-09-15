“use strict”;

const fs = require(“fs”);
const path = require(“path”);

const PICTURES_DIRECTORY = path.join(
__dirname,
“pictures”
);

const SUPPORTED_EXTENSIONS = new Set([
“.jpg”,
“.jpeg”,
“.png”,
“.gif”,
“.webp”,
]);

/**

* Get all supported pictures from the pictures/ folder.
    */
    function getPictureFiles() {
    try {
    if (!fs.existsSync(PICTURES_DIRECTORY)) {
    return [];
    }
    return fs
    .readdirSync(PICTURES_DIRECTORY)
    .filter((fileName) =>
    SUPPORTED_EXTENSIONS.has(
    path.extname(fileName).toLowerCase()
    )
    );
    } catch (error) {
    console.error(
    “[PICTURES] Failed to read pictures directory:”,
    error
    );
    return [];
    }
    }

/**

* Get a random picture path.
* IMPORTANT:
* This ONLY reads from /pictures.
* It never reads from /memes.
    */
    function getRandomPicturePath() {
    const files = getPictureFiles();

if (files.length === 0) {
return null;
}

const randomFile =
files[
Math.floor(
Math.random() * files.length
)
];

return path.join(
PICTURES_DIRECTORY,
randomFile
);
}

/**

* Send a random picture to a Messenger thread.
    */
    function sendRandomPicture(
    api,
    threadID,
    message = “”
    ) {
    const picturePath =
    getRandomPicturePath();

if (!picturePath) {
api.sendMessage(
[
“🖼️ No pictures are available yet.”,
“”,
“Add .jpg, .jpeg, .png, .gif, or .webp files to:”,
“pictures/”,
].join(”\n”),
threadID,
(error) => {
if (error) {
console.error(
“[PICTURES] Failed to send empty-folder message:”,
error
);
}
}
);

return;

}

try {
const outgoingMessage = {
body: message,
attachment:
fs.createReadStream(picturePath),
};

api.sendMessage(
  outgoingMessage,
  threadID,
  (error) => {
    if (error) {
      console.error(
        "[PICTURES] Failed to send picture:",
        error
      );
    }
  }
);

} catch (error) {
console.error(
“[PICTURES] Picture send error:”,
error
);
}
}

module.exports = {
getRandomPicturePath,
sendRandomPicture,
};
