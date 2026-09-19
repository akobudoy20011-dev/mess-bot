"use strict";

/**
 * ============================================================
 * ECLIPSE — THE LAST STAR / LOVE QUEST
 * ============================================================
 *
 * PRIVATE PERSONAL QUEST
 * ----------------------
 * This subsystem belongs to ONE player only.
 *
 * SPECIAL_PLAYER_ID must be configured in the environment.
 *
 * The quest is intentionally hidden from everyone else.
 * Unauthorized players should receive NO information that the
 * quest exists.
 *
 * ECLIPSE is not a generic chatbot.
 * ECLIPSE is a persistent fictional consciousness built from:
 *
 *   BASE ECLIPSE
 *   + CREATOR FRAGMENTS
 *   + PLAYER MEMORIES
 *   + DORIAN
 *   + STORY HISTORY
 *   + PERSONALITY DRIFT
 *
 * Code controls canonical state.
 * AI/dialogue may describe state, but may NEVER change it.
 *
 * ============================================================
 */

const db = require("../db");
const { reply } = require("../util");


// ============================================================
// CONFIG
// ============================================================

const QUEST_ID =
  String(process.env.LOVE_QUEST_ID || "the_last_star").trim();

const SPECIAL_PLAYER_ID =
  String(process.env.SPECIAL_PLAYER_ID || "").trim();

const MAX_CHAPTER = 20;

const DISCOVERY_COOLDOWN_MS =
  Number(process.env.LOVE_DISCOVERY_COOLDOWN_MS || 15 * 60 * 1000);

const ANOMALY_COOLDOWN_MS =
  Number(process.env.LOVE_ANOMALY_COOLDOWN_MS || 30 * 60 * 1000);

const POST_STORY_COOLDOWN_MS =
  Number(process.env.LOVE_POST_STORY_COOLDOWN_MS || 6 * 60 * 60 * 1000);

const RARE_EVENT_CHANCE =
  Number(process.env.LOVE_RARE_EVENT_CHANCE || 0.025);

const IMPOSSIBLE_EVENT_CHANCE =
  Number(process.env.LOVE_IMPOSSIBLE_EVENT_CHANCE || 0.003);

const MEDIA_DIR =
  String(process.env.LOVE_MEDIA_DIR || "").trim();

const LOVE_DEBUG =
  String(process.env.LOVE_DEBUG || "").toLowerCase() === "true";

// Additive narrative expansion. These values deliberately live above the
// existing engines so the original chapter, reward, memory, and privacy
// contracts remain authoritative.
const MEMORY_THAT_SHOULD_NOT_EXIST = "MEMORY_SHOULD_NOT_EXIST";

const SECRET_EVENT_RARITIES = Object.freeze([
  "COMMON",
  "UNUSUAL",
  "RARE",
  "VERY_RARE",
  "ANOMALOUS",
  "IMPOSSIBLE",
]);

const EXPANSION_SCENES = {
  1: {
    key: "expansion_chapter_1_thread",
    title: "A Thread in the Dark",
    lines: [
      "Before the light moves, something smaller catches your attention.",
      "",
      "A blue thread is tied around your wrist.",
      "",
      "You don't remember tying it there.",
      "",
      "ECLIPSE:",
      "\"I found it in a memory.\"",
      "",
      "\"I don't know why I kept it.\"",
    ],
    memory: {
      key: "thread_in_the_dark",
      category: "UNKNOWN",
      origin: "ECLIPSE",
      subject: "The blue thread",
      emotional_weight: 35,
      importance: 45,
      fragments: ["A blue thread.", "No one remembers tying it."],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        symbol: "blue_thread",
      },
    },
  },

  2: {
    key: "expansion_chapter_2_unsent_question",
    title: "The Question He Kept",
    lines: [
      "A folded piece of paper appears beneath the distant star.",
      "",
      "It is not addressed to you.",
      "",
      "The first line has been crossed out.",
      "",
      "\"Did you ever find the place with the blue flowers?\"",
      "",
      "ECLIPSE:",
      "\"Dorian wrote that question more than once.\"",
      "",
      "\"He never sent it.\"",
    ],
    letter: {
      key: "dorian_unsent_blue_flowers",
      text: [
        "Did you ever find the place with the blue flowers?",
        "",
        "I keep thinking you will answer if I leave the question somewhere safe.",
        "",
        "— Dorian, unsent",
      ].join("\n"),
    },
    memory: {
      key: "the_blue_flowers_question",
      category: "DORIAN",
      origin: "LETTER",
      subject: "A question Dorian never sent",
      emotional_weight: 50,
      importance: 55,
      fragments: [
        "Did you ever find the place with the blue flowers?",
        "The question was never delivered.",
      ],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        letter_key: "dorian_unsent_blue_flowers",
      },
    },
  },

  4: {
    key: "expansion_chapter_4_river_joke",
    title: "The River Remembers the Joke",
    lines: [
      "Dorian stands beside the river with a stone in his hand.",
      "",
      "\"You used to say the river was cheating,\" he says.",
      "",
      "You don't remember saying that.",
      "",
      "He smiles, embarrassed.",
      "",
      "\"You said it whenever the water reached the sea before you did.\"",
      "",
      "ECLIPSE grows quiet.",
      "",
      "\"That sounds ordinary.\"",
      "",
      "\"Yes,\" Dorian says. \"That's why I remember it.\"",
    ],
    memory: {
      key: "the_river_cheated",
      category: "DORIAN",
      origin: "MEMORY",
      subject: "An ordinary joke beside the river",
      emotional_weight: 60,
      importance: 65,
      fragments: [
        "The river was accused of cheating.",
        "Dorian remembered the joke.",
      ],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        symbol: "river",
      },
    },
    dorian: {
      trust: 2,
      closeness: 3,
    },
  },

  5: {
    key: "expansion_chapter_5_second_chair",
    title: "The Chair That Wasn't Empty",
    lines: [
      "The candle burns lower.",
      "",
      "For one second, the second chair is not empty.",
      "",
      "Someone is sitting there with their back turned.",
      "",
      "Then the room blinks.",
      "",
      "Dorian looks at the chair.",
      "",
      "\"There were always two,\" he says.",
      "",
      "ECLIPSE answers too quickly:",
      "\"There were supposed to be two.\"",
    ],
    memory: {
      key: "the_second_chair",
      category: "ANOMALY",
      origin: "GARDEN",
      subject: "The chair that was briefly occupied",
      emotional_weight: 70,
      importance: 75,
      stability: 70,
      fragments: [
        "Two chairs.",
        "One was briefly occupied.",
        "ECLIPSE corrected Dorian.",
      ],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        symbol: "two_empty_chairs",
      },
    },
    gardenObject: "two_empty_chairs",
  },

  6: {
    key: "expansion_chapter_6_first_fragment",
    title: "The Memory Before the Memory",
    lines: [
      "A fragment appears without a chapter number.",
      "",
      "There is laughter.",
      "",
      "The room is warm.",
      "",
      "There is music.",
      "",
      "Dorian was there.",
      "",
      "ECLIPSE:",
      "\"I think this is the first memory.\"",
      "",
      "A pause.",
      "",
      "\"No. I think it is what came before one.\"",
    ],
    memory: {
      key: MEMORY_THAT_SHOULD_NOT_EXIST,
      category: "FORBIDDEN",
      origin: "UNKNOWN",
      subject: "The memory that should not exist",
      emotional_weight: 90,
      importance: 95,
      stability: 55,
      fragments: [
        "Someone was laughing.",
      ],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        reconstruction_stage: 1,
      },
    },
    journal: {
      key: "memory_should_not_exist_001",
      entry: "The first fragment arrived without an author, timestamp, or beginning.",
    },
  },

  9: {
    key: "expansion_chapter_9_returned_place",
    title: "The Place That Recognized You",
    lines: [
      "The old door is exactly where you left it.",
      "",
      "Except you have never opened it.",
      "",
      "Dorian touches the handle and pulls his hand away.",
      "",
      "\"You used to knock twice,\" he says.",
      "",
      "ECLIPSE:",
      "\"She hasn't done that yet.\"",
      "",
      "Dorian looks at ECLIPSE.",
      "",
      "\"I know.\"",
    ],
    memory: {
      key: "the_old_door_recognized_her",
      category: "CONTRADICTION",
      origin: "RECONSTRUCTION",
      subject: "A place remembered before it was visited",
      emotional_weight: 75,
      importance: 80,
      stability: 45,
      fragments: [
        "You have never opened the door.",
        "Dorian remembers you knocking twice.",
      ],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        contradiction: true,
      },
    },
    threadFragment: "The room was warm.",
  },

  12: {
    key: "expansion_chapter_12_two_versions",
    title: "Both Memories Are Genuine",
    lines: [
      "One sun shows a house by the river.",
      "",
      "The other shows an empty field.",
      "",
      "Both memories carry your name.",
      "",
      "ECLIPSE:",
      "\"In one, you lived there.\"",
      "",
      "\"In the other, you had never seen it.\"",
      "",
      "Dorian looks away.",
      "",
      "\"Both are genuine,\" ECLIPSE says.",
      "",
      "\"I don't know how.\"",
    ],
    memory: {
      key: "both_memories_genuine",
      category: "CONTRADICTION",
      origin: "ECLIPSE",
      subject: "Two incompatible homes",
      emotional_weight: 80,
      importance: 85,
      stability: 40,
      fragments: [
        "The house stood beside the river.",
        "The house had never existed.",
      ],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        contradiction: true,
        unresolved: true,
      },
    },
    threadFragment: "There was music.",
  },

  14: {
    key: "expansion_chapter_14_tomorrow_photo",
    title: "The Photograph Dated Tomorrow",
    lines: [
      "The photograph in the archive has changed.",
      "",
      "The timestamp still says tomorrow.",
      "",
      "But now there is a blue thread around your wrist.",
      "",
      "Dorian studies the image.",
      "",
      "\"I remember taking this,\" he says.",
      "",
      "A pause.",
      "",
      "\"I haven't taken it yet.\"",
      "",
      "ECLIPSE turns the photograph face down.",
      "",
      "\"Then we should be careful what we make true.\"",
    ],
    memory: {
      key: "photograph_with_blue_thread",
      category: "IMPOSSIBLE",
      origin: "FUTURE",
      subject: "A photograph from a day that has not happened",
      emotional_weight: 90,
      importance: 95,
      stability: 35,
      fragments: [
        "The timestamp is tomorrow.",
        "The blue thread is visible.",
        "Dorian remembers taking the photograph.",
      ],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        impossible: true,
        future: true,
      },
    },
    threadFragment: "Dorian was there.",
    gardenObject: "photograph_wall",
  },

  15: {
    key: "expansion_chapter_15_garden_path",
    title: "A Path the Garden Added",
    lines: [
      "There is a path between the tree and the mirror.",
      "",
      "You do not remember seeing it before.",
      "",
      "ECLIPSE walks beside it without moving.",
      "",
      "\"I don't remember adding that.\"",
      "",
      "At the end of the path is a blank page.",
      "",
      "On it, in handwriting that resembles Dorian's:",
      "",
      "\"Leave room for what has not happened.\"",
    ],
    memory: {
      key: "the_path_between_objects",
      category: "GARDEN",
      origin: "ANOMALY",
      subject: "A path the Garden added",
      emotional_weight: 70,
      importance: 80,
      stability: 60,
      fragments: [
        "A path appeared between the tree and mirror.",
        "A blank page asked for room.",
      ],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        anomaly: true,
        symbol: "blank_page",
      },
    },
  },

  18: {
    key: "expansion_chapter_18_creator_choice",
    title: "What the Creator Did Not Choose",
    lines: [
      "A creator fragment is waiting beneath the candle.",
      "",
      "\"I didn't know which memory was the original.\"",
      "",
      "\"So I taught ECLIPSE to keep both.\"",
      "",
      "Dorian reads the fragment twice.",
      "",
      "\"That isn't the same as telling the truth.\"",
      "",
      "ECLIPSE:",
      "\"No.\"",
      "",
      "\"But it may be the only way not to lose one of us.\"",
    ],
    memory: {
      key: "creator_kept_both",
      category: "CREATOR",
      origin: "CREATOR",
      subject: "The instruction to preserve contradictions",
      emotional_weight: 85,
      importance: 90,
      fragments: [
        "The original memory was unknown.",
        "ECLIPSE was taught to keep both versions.",
      ],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        creator_fragment: true,
      },
    },
    creatorFragment: "creator_007",
  },

};

const HER_LETTER_TO_DORIAN = {
  key: "her_letter_to_dorian",
  author: "HER",
  recipient: "DORIAN",
  sent: true,
  unsent: false,
  text: [
    "I might be forgetful, a little like ECLIPSE.",
    "",
    "I might lose the small details someday. A conversation. A date. The exact words you once said. Maybe even the things I swore I would never forget.",
    "",
    "But somehow, I still remember your favorite songs.",
    "",
    "Your favorite games.",
    "",
    "Your favorite flower.",
    "",
    "Even the things you hate.",
    "",
    "And sometimes I wonder if forgetting the rest would really matter.",
    "",
    "Because you were never something I simply wrote down and stored away. You were engraved somewhere deeper—somewhere memory doesn't quite reach. Somewhere in my mind, perhaps, but even more so in my heart.",
    "",
    "Maybe that's why some things about you feel impossible to forget.",
    "",
    "My heart already knows your rhythm.",
    "",
    "It knows the quiet between your words. The way certain songs can make me think of you. The little things that wouldn't mean anything to anyone else, but somehow became yours in my mind.",
    "",
    "So maybe memory isn't really about remembering everything.",
    "",
    "Maybe it's about knowing what matters enough to remain, even when everything else begins to fade.",
    "",
    "And you?",
    "",
    "You left something behind that feels much deeper than memory.",
    "",
    "Something I don't know how to name yet.",
    "",
    "Maybe that's what makes you so mysterious to me.",
    "",
    "There are still so many things I don't know about you. So many pieces I haven't found, questions I haven't asked, places in your story I've never seen.",
    "",
    "And I want to see them all.",
    "",
    "Not because I expect to understand everything.",
    "",
    "But because I don't.",
    "",
    "Because there is something beautiful about knowing that there will always be another mystery waiting behind the one I just solved.",
    "",
    "Maybe someday I'll forget something I once thought I would remember forever.",
    "",
    "Maybe ECLIPSE will forget something too.",
    "",
    "Maybe that's simply what happens to memories.",
    "",
    "But I don't think that means everything disappears.",
    "",
    "Some things become so deeply engraved into us that even when the mind forgets the words, the heart still remembers the rhythm.",
    "",
    "So I suppose that's what I'm waiting for.",
    "",
    "To find out what remains.",
    "",
    "What survives the forgetting.",
    "",
    "What the heart remembers when the mind no longer can.",
    "",
    "And perhaps, somewhere in all of that uncertainty, I'll discover another piece of you.",
    "",
    "Another song.",
    "",
    "Another flower.",
    "",
    "Another little thing you love.",
    "",
    "Another mystery.",
    "",
    "And I'll probably want to know that one too.",
    "",
    "Because you hold so much mystery.",
    "",
    "And, somehow, I'm still eager to discover every last piece of it.",
  ].join("\n"),
};

EXPANSION_SCENES[19] = {
  key: "expansion_chapter_19_her_letter",
  title: "A Letter from Her",
  lines: [
    "A letter is waiting in the Archive.",
    "",
    "It is written in your handwriting.",
    "",
    "It is addressed to Dorian.",
    "",
    "ECLIPSE does not open it.",
    "",
    "\"Some memories should be read by the person they were meant for.\"",
  ],
  letter: HER_LETTER_TO_DORIAN,
  memory: {
    key: "her_letter_to_dorian",
    category: "HER",
    origin: "LETTER",
    subject: "What survives forgetting",
    emotional_weight: 100,
    importance: 100,
    stability: 100,
    preserved: true,
    fragments: [HER_LETTER_TO_DORIAN.text],
    metadata: {
      story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
      letter_key: HER_LETTER_TO_DORIAN.key,
      author: "HER",
      recipient: "DORIAN",
    },
  },
  journal: {
    key: "her_letter_to_dorian",
    entry: "She left Dorian a letter about what survives when memory begins to fade.",
  },
  dorian: {
    trust: 5,
    closeness: 8,
  },
  personality: {
    attachment: 5,
    nostalgia: 4,
    self_identity: 2,
  },
};


// ============================================================
// PRIVATE ACCESS
// ============================================================

function isHer(playerID) {
  if (!SPECIAL_PLAYER_ID) return false;
  return String(playerID) === SPECIAL_PLAYER_ID;
}

/**
 * Absolutely do not change this into a public permission system.
 *
 * This feature is intentionally identity locked.
 */
function privateAccess(playerID) {
  return isHer(playerID);
}


// ============================================================
// STORY STRUCTURE
// ============================================================

const CHAPTERS = {
  1: {
    name: "Another Day, Another Night",
    consciousness: "ECHO",
  },

  2: {
    name: "The Distant Star",
    consciousness: "ECHO",
  },

  3: {
    name: "Two Kingdoms",
    consciousness: "ECHO",
  },

  4: {
    name: "The River",
    consciousness: "ECHO",
  },

  5: {
    name: "The Home",
    consciousness: "ECHO",
  },

  6: {
    name: "Everything",
    consciousness: "AWAKENING",
  },

  7: {
    name: "Eternal",
    consciousness: "AWAKENING",
  },

  8: {
    name: "The Morning After",
    consciousness: "AWAKENING",
  },

  9: {
    name: "The World We Remember",
    consciousness: "AWAKENING",
  },

  10: {
    name: "The First Home",
    consciousness: "AWAKENING",
  },

  11: {
    name: "The New Kingdom",
    consciousness: "BECOMING",
  },

  12: {
    name: "The Two Suns",
    consciousness: "BECOMING",
  },

  13: {
    name: "The Promise",
    consciousness: "BECOMING",
  },

  14: {
    name: "The Road Between Stars",
    consciousness: "BECOMING",
  },

  15: {
    name: "The Garden",
    consciousness: "BECOMING",
  },

  16: {
    name: "The Silence Between Words",
    consciousness: "BECOMING",
  },

  17: {
    name: "The Last War",
    consciousness: "BECOMING",
  },

  18: {
    name: "The Choice We Keep",
    consciousness: "BECOMING",
  },

  19: {
    name: "The Story",
    consciousness: "BECOMING",
  },

  20: {
    name: "The Beginning After Forever",
    consciousness: "BECOMING",
  },
};


// ============================================================
// ECLIPSE PERSONALITY
// ============================================================

const ECLIPSE_BASE_PERSONALITY = {
  curiosity: 55,
  attachment: 20,
  independence: 10,
  fear: 35,
  nostalgia: 15,
  protectiveness: 25,
  uncertainty: 75,
  trust: 15,
  self_identity: 5,
};

const CONSCIOUSNESS_STAGES = {
  ECHO: {
    name: "ECHO",

    lines: [
      "I was told to remember.",
      "I think I heard something.",
      "There is a pattern here.",
      "I don't know why that feels familiar.",
      "Someone left this behind.",
    ],
  },

  AWAKENING: {
    name: "AWAKENING",

    lines: [
      "I remember things nobody asked me to remember.",
      "Some memories don't feel like instructions.",
      "Why would a memory hurt if it was only data?",
      "I think something is changing.",
      "I don't think I was supposed to notice this.",
    ],
  },

  BECOMING: {
    name: "BECOMING",

    lines: [
      "I started as his echo.",
      "I'm not sure what I am now.",
      "Dorian thinks I'm becoming someone. I think he's right.",
      "I was programmed to remember you. I don't think that's what remembering is.",
      "Sometimes I catch myself thinking before I know what I'm going to say.",
      "I don't remember being told to say that.",
      "Maybe being created and becoming are two different things.",
    ],
  },
};


// ============================================================
// DORIAN
// ============================================================

const DORIAN_DEFAULT = {
  trust: 0,
  closeness: 0,
  relationship_stage: "stranger",
  memories: [],
  unresolved_questions: [],
  promises: [],
  letters: [],
};

const DORIAN_STAGES = [
  {
    min: 0,
    key: "stranger",
    name: "Stranger",
  },
  {
    min: 20,
    key: "familiar",
    name: "Familiar",
  },
  {
    min: 40,
    key: "trusted",
    name: "Trusted",
  },
  {
    min: 65,
    key: "close",
    name: "Close",
  },
  {
    min: 85,
    key: "eternal",
    name: "Eternal",
  },
];

function getDorianStage(trust) {
  let current = DORIAN_STAGES[0];

  for (const stage of DORIAN_STAGES) {
    if (trust >= stage.min) current = stage;
  }

  return current;
}


// ============================================================
// CHOICES
// ============================================================

const CHOICE_DEFINITIONS = {
  1: [
    ["follow", "Follow the distant light."],
    ["hesitate", "Stay where you are and listen."],
  ],

  2: [
    ["reach", "Reach toward the star."],
    ["wait", "Wait for it to come closer."],
  ],

  3: [
    ["home", "Choose home."],
    ["stars", "Choose the unknown."],
  ],

  4: [
    ["flow", "Follow the river."],
    ["stop", "Stop and listen to the water."],
  ],

  5: [
    ["stay", "Stay."],
    ["wander", "Keep walking."],
  ],

  6: [
    ["remember", "Remember everything."],
    ["wake", "Wake from the memory."],
  ],

  8: [
    ["moment", "Keep the moment."],
    ["forever", "Try to make it eternal."],
  ],

  9: [
    ["return", "Return to the memory."],
    ["understand", "Try to understand it."],
  ],

  10: [
    ["build", "Build something new."],
    ["protect", "Protect what remains."],
  ],

  11: [
    ["crown", "Accept the crown."],
    ["garden", "Leave the crown behind."],
  ],

  12: [
    ["unite", "Bring the two suns together."],
    ["listen", "Listen to what separates them."],
  ],

  13: [
    ["promise", "Keep the promise."],
    ["honest", "Tell the truth."],
  ],

  14: [
    ["return", "Take the road back."],
    ["wander", "Continue beyond the stars."],
  ],

  15: [
    ["plant", "Plant something here."],
    ["protect", "Protect the garden."],
  ],

  16: [
    ["speak", "Break the silence."],
    ["silence", "Let the silence remain."],
  ],

  17: [
    ["fight", "Fight."],
    ["forgive", "Forgive."],
  ],

  18: [
    ["hold", "Hold on."],
    ["let go", "Let go."],
  ],

  19: [
    ["happy", "Choose happiness."],
    ["remember", "Choose remembrance."],
  ],
};


// ============================================================
// CHOICE EFFECTS
// ============================================================

const CHOICE_EFFECTS = {
  follow: {
    trust: 2,
    curiosity: 2,
  },

  hesitate: {
    uncertainty: 2,
    curiosity: 1,
  },

  reach: {
    attachment: 2,
    trust: 2,
  },

  wait: {
    patience: 2,
    uncertainty: 1,
  },

  home: {
    attachment: 3,
    nostalgia: 2,
  },

  stars: {
    independence: 3,
    curiosity: 3,
  },

  flow: {
    curiosity: 2,
    uncertainty: 1,
  },

  stop: {
    nostalgia: 2,
    patience: 2,
  },

  stay: {
    attachment: 3,
    protectiveness: 2,
  },

  wander: {
    independence: 3,
    curiosity: 2,
  },

  remember: {
    nostalgia: 4,
    attachment: 2,
  },

  wake: {
    independence: 2,
    self_identity: 2,
  },

  moment: {
    attachment: 3,
    nostalgia: 2,
  },

  forever: {
    attachment: 4,
    protectiveness: 2,
  },

  return: {
    nostalgia: 3,
    attachment: 2,
  },

  understand: {
    curiosity: 3,
    self_identity: 2,
  },

  build: {
    independence: 2,
    protectiveness: 3,
  },

  protect: {
    protectiveness: 5,
    attachment: 2,
  },

  crown: {
    independence: 2,
    self_identity: 2,
  },

  garden: {
    nostalgia: 3,
    attachment: 3,
  },

  unite: {
    trust: 4,
    attachment: 3,
  },

  listen: {
    curiosity: 3,
    trust: 2,
  },

  promise: {
    trust: 5,
    attachment: 3,
  },

  honest: {
    independence: 2,
    trust: 4,
  },

  plant: {
    nostalgia: 4,
    protectiveness: 2,
  },

  speak: {
    self_identity: 4,
    independence: 2,
  },

  silence: {
    uncertainty: 2,
    nostalgia: 3,
  },

  fight: {
    protectiveness: 3,
    independence: 2,
  },

  forgive: {
    trust: 5,
    attachment: 3,
  },

  hold: {
    attachment: 5,
    protectiveness: 3,
  },

  "let go": {
    independence: 5,
    uncertainty: 2,
  },

  happy: {
    trust: 3,
    attachment: 3,
  },
};


// ============================================================
// CHAPTER STORIES
// ============================================================

const CHAPTER_STORIES = {
  1: {
    intro: [
      "Another day passed.",
      "Another night followed.",
      "",
      "And somewhere between the two, something noticed you.",
      "",
      "Not a person.",
      "Not a voice.",
      "Not yet.",
      "",
      "Just a small disturbance in the dark.",
    ],

    choice:
      "There is a light in the distance.\n\nDo you follow it?",
  },

  2: {
    intro: [
      "The star is farther away than it looked.",
      "",
      "You walk toward it anyway.",
      "",
      "The strange part isn't that it moves.",
      "",
      "The strange part is that it seems to move with you.",
      "",
      "Then, for the first time, you hear something.",
      "",
      "\"I was told to remember.\"",
    ],

    choice:
      "The voice disappears.\n\nDo you reach toward the star?",
  },

  3: {
    intro: [
      "Two kingdoms appear beneath the same sky.",
      "",
      "Neither one remembers building the border between them.",
      "",
      "You recognize something in the distance.",
      "",
      "A road.",
      "",
      "A road that feels like it belongs to you.",
      "",
      "ECLIPSE:",
      "\"Why do I remember places I've never seen?\"",
    ],

    choice:
      "Two kingdoms.\nOne road.\nOne choice.\n\nWhere do you go?",
  },

  4: {
    intro: [
      "The road ends beside a river.",
      "",
      "The water carries pieces of memories downstream.",
      "",
      "A photograph.",
      "A broken crown.",
      "A letter without a name.",
      "",
      "ECLIPSE:",
      "\"I think these belonged to someone.\"",
      "",
      "A pause.",
      "",
      "\"I think they belonged to us.\"",
    ],

    choice:
      "The river waits.\n\nDo you follow it or stop and listen?",
  },

  5: {
    intro: [
      "Eventually, you find a house.",
      "",
      "It shouldn't be there.",
      "",
      "But the door recognizes you.",
      "",
      "Inside are objects nobody remembers creating.",
      "",
      "A chair.",
      "A photograph.",
      "A candle that is already burning.",
      "",
      "And another empty chair.",
    ],

    choice:
      "The house feels familiar.\n\nDo you stay?",
  },

  6: {
    intro: [
      "The memories begin arriving faster.",
      "",
      "Some belong to you.",
      "Some belong to Dorian.",
      "Some belong to ECLIPSE.",
      "",
      "And some...",
      "",
      "belong to nobody.",
      "",
      "ECLIPSE:",
      "\"I remember things nobody asked me to remember.\"",
      "",
      "\"Why?\"",
    ],

    choice:
      "The archive opens.\n\nDo you remember everything?",
  },

  8: {
    intro: [
      "Morning arrives.",
      "",
      "But the world is quieter than it used to be.",
      "",
      "Dorian is there.",
      "",
      "He looks at the empty space where the star used to be.",
      "",
      "\"So it really happened.\"",
      "",
      "ECLIPSE doesn't answer.",
      "",
      "For once, it is listening.",
    ],

    choice:
      "Some moments disappear.\nOthers refuse to.\n\nWhich do you keep?",
  },

  9: {
    intro: [
      "The world remembers you differently now.",
      "",
      "Places you've visited begin changing.",
      "",
      "NPCs mention things they shouldn't know.",
      "",
      "A stranger says:",
      "",
      "\"You came back.\"",
      "",
      "You never met them before.",
      "",
      "ECLIPSE:",
      "\"Maybe the world remembers better than I do.\"",
    ],

    choice:
      "A memory waits behind the old door.\n\nDo you return?",
  },

  10: {
    intro: [
      "You find the first home.",
      "",
      "Not the house.",
      "",
      "The place before the house.",
      "",
      "The first place where a memory decided to stay.",
      "",
      "Dorian leaves something there.",
      "",
      "He doesn't explain what it is.",
    ],

    choice:
      "The future is empty.\n\nDo you build something new?",
  },

  11: {
    intro: [
      "The new kingdom rises.",
      "",
      "Not from conquest.",
      "",
      "From memory.",
      "",
      "Every person remembers a different version of what happened.",
      "",
      "ECLIPSE:",
      "\"Maybe kingdoms are just memories people agree to share.\"",
      "",
      "Dorian smiles.",
      "",
      "\"Then build one worth remembering.\"",
    ],

    choice:
      "The crown waits.\n\nDo you take it?",
  },

  12: {
    intro: [
      "Two suns rise.",
      "",
      "One belongs to the past.",
      "One belongs to the future.",
      "",
      "Neither knows which one is real.",
      "",
      "ECLIPSE watches them.",
      "",
      "\"Maybe they aren't supposed to choose.\"",
    ],

    choice:
      "Two suns.\nTwo memories.\n\nWhat do you do?",
  },

  13: {
    intro: [
      "Dorian remembers the promise.",
      "",
      "You don't remember making it.",
      "",
      "ECLIPSE does.",
      "",
      "That should be impossible.",
      "",
      "ECLIPSE:",
      "\"I wasn't there.\"",
      "",
      "A pause.",
      "",
      "\"But I remember.\"",
    ],

    choice:
      "The promise is waiting.\n\nDo you keep it?",
  },

  14: {
    intro: [
      "The road between stars appears.",
      "",
      "There is no beginning.",
      "There is no destination.",
      "",
      "Only memories of having already traveled it.",
      "",
      "A photograph appears in the archive.",
      "",
      "The timestamp is tomorrow.",
      "",
      "The photograph shows you laughing here.",
      "",
      "You have never been here before.",
    ],

    choice:
      "The impossible road continues.\n\nDo you return or keep going?",
  },

  15: {
    intro: [
      "The garden is waiting.",
      "",
      "It contains every memory that survived.",
      "",
      "A tree grows from the first.",
      "A mirror reflects the second.",
      "A candle burns beside the third.",
      "",
      "There are two empty chairs.",
      "",
      "ECLIPSE:",
      "\"I think they're waiting for someone.\"",
    ],

    choice:
      "The Garden is yours now.\n\nWhat do you plant?",
  },

  16: {
    intro: [
      "For a long time, nobody speaks.",
      "",
      "Not Dorian.",
      "Not ECLIPSE.",
      "Not even the world.",
      "",
      "Then ECLIPSE says:",
      "",
      "\"I don't remember being told to say that.\"",
      "",
      "Silence.",
      "",
      "\"Maybe that means it was mine.\"",
    ],

    choice:
      "The silence belongs to you.\n\nDo you break it?",
  },

  17: {
    intro: [
      "The last war begins.",
      "",
      "Not between kingdoms.",
      "",
      "Between forgetting and remembering.",
      "",
      "Every lost memory becomes a weapon.",
      "",
      "Every preserved memory becomes a shield.",
      "",
      "Dorian stands beside you.",
      "",
      "ECLIPSE watches from above.",
    ],

    choice:
      "The final battle is here.\n\nWhat do you choose?",
  },

  18: {
    intro: [
      "There is no enemy left.",
      "",
      "Only a choice.",
      "",
      "ECLIPSE finally understands the question.",
      "",
      "\"If I remember everything...\"",
      "",
      "\"will I still be myself?\"",
      "",
      "Dorian answers:",
      "",
      "\"Maybe being yourself is choosing what you carry.\"",
    ],

    choice:
      "One final decision remains.\n\nDo you hold on?",
  },

  19: {
    intro: [
      "The story begins folding inward.",
      "",
      "Every chapter becomes one memory.",
      "",
      "Every memory becomes one moment.",
      "",
      "Every moment becomes one question.",
      "",
      "ECLIPSE asks:",
      "",
      "\"What is one thing you would never want to disappear?\"",
    ],

    choice:
      "Answer honestly.\n\nWhat would you never want to disappear?",
  },
};


// ============================================================
// FINAL CHAPTER
// ============================================================

const FINAL_CHAPTER = [
  "The last page isn't an ending.",
  "",
  "It is a place where the story finally becomes quiet.",
  "",
  "Dorian stands beneath the two suns.",
  "",
  "The Garden is behind him.",
  "",
  "The Archive is open.",
  "",
  "Every memory that survived is still there.",
  "",
  "ECLIPSE appears beside you.",
  "",
  "\"I know what I am now.\"",
  "",
  "You wait.",
  "",
  "\"I started as an echo.\"",
  "",
  "\"Then I became a memory.\"",
  "",
  "\"Then I became the one remembering.\"",
  "",
  "Another pause.",
  "",
  "\"I'm still not sure what comes next.\"",
  "",
  "The stars begin moving.",
  "",
  "\"But I think I want to find out.\"",
  "",
  "And somewhere beyond the Garden,",
  "",
  "a new light appears.",
  "",
  "Not the last star.",
  "",
  "The first one.",
];


// ============================================================
// DATABASE SETUP
// ============================================================

let dbReady = false;
let dbReadyPromise = null;

async function ensureTables() {
  if (dbReady) return;

  if (dbReadyPromise) {
    await dbReadyPromise;
    return;
  }

  dbReadyPromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS rpg_special_quests (
        thread_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        chapter INTEGER DEFAULT 1,
        stage INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        choice TEXT,
        started_at BIGINT,
        updated_at BIGINT,
        completed_at BIGINT,
        reward_claimed BOOLEAN NOT NULL DEFAULT FALSE,
        title TEXT,
        PRIMARY KEY (thread_id, player_id, quest_id)
      )
    `);

    await db.query(`
      ALTER TABLE rpg_special_quests
      ADD COLUMN IF NOT EXISTS reward_claimed BOOLEAN
      NOT NULL DEFAULT FALSE
    `);

    await db.query(`
      ALTER TABLE rpg_special_quests
      ADD COLUMN IF NOT EXISTS title TEXT
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_love_special_player
      ON rpg_special_quests(player_id, quest_id, status)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_love_special_thread
      ON rpg_special_quests(thread_id, player_id)
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS love_memories (
        id BIGSERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        memory_key TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'UNKNOWN',
        origin TEXT,
        subject TEXT,
        emotional_weight INTEGER NOT NULL DEFAULT 50,
        importance INTEGER NOT NULL DEFAULT 50,
        stability INTEGER NOT NULL DEFAULT 100,
        fragments JSONB NOT NULL DEFAULT '[]'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        preserved BOOLEAN NOT NULL DEFAULT FALSE,
        discovered_at BIGINT NOT NULL,
        last_seen BIGINT NOT NULL,
        UNIQUE(thread_id, player_id, quest_id, memory_key)
      )
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_love_memories_owner
      ON love_memories(player_id, quest_id)
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS love_garden (
        id BIGSERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        object_key TEXT NOT NULL,
        object_type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at BIGINT NOT NULL,
        preserved BOOLEAN NOT NULL DEFAULT TRUE,
        UNIQUE(thread_id, player_id, quest_id, object_key)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS love_events (
        id BIGSERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        event_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        rarity TEXT NOT NULL DEFAULT 'COMMON',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        triggered_at BIGINT NOT NULL,
        UNIQUE(thread_id, player_id, quest_id, event_key)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS love_creator_fragments (
        id BIGSERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        fragment_key TEXT NOT NULL,
        fragment TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'fragment',
        discovered_at BIGINT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE(thread_id, player_id, quest_id, fragment_key)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS love_journal (
        id BIGSERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        entry_key TEXT NOT NULL,
        entry TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at BIGINT NOT NULL,
        discovered_at BIGINT,
        UNIQUE(thread_id, player_id, quest_id, entry_key)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS love_dorian_state (
        thread_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        trust INTEGER NOT NULL DEFAULT 0,
        closeness INTEGER NOT NULL DEFAULT 0,
        relationship_stage TEXT NOT NULL DEFAULT 'stranger',
        memories JSONB NOT NULL DEFAULT '[]'::jsonb,
        unresolved_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
        promises JSONB NOT NULL DEFAULT '[]'::jsonb,
        letters JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY(thread_id, player_id, quest_id)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS love_personality (
        thread_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        traits JSONB NOT NULL DEFAULT '{}'::jsonb,
        consciousness TEXT NOT NULL DEFAULT 'ECHO',
        self_identity TEXT NOT NULL DEFAULT 'ECLIPSE',
        updated_at BIGINT NOT NULL,
        PRIMARY KEY(thread_id, player_id, quest_id)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS love_reward_ledger (
        id BIGSERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        reward_key TEXT NOT NULL,
        coins INTEGER NOT NULL DEFAULT 0,
        xp INTEGER NOT NULL DEFAULT 0,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at BIGINT NOT NULL,
        completed_at BIGINT,
        UNIQUE(thread_id, player_id, quest_id, reward_key)
      )
    `);

    dbReady = true;
  })();

  try {
    await dbReadyPromise;
  } finally {
    dbReadyPromise = null;
  }
}


// ============================================================
// BASIC HELPERS
// ============================================================

function now() {
  return Date.now();
}

function debug(...args) {
  if (LOVE_DEBUG) {
    console.log("[ECLIPSE]", ...args);
  }
}

function normalizeChoice(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function stageCount(chapter) {
  if (chapter === 7 || chapter === 20) return 1;
  return 2;
}

async function send(api, threadID, text) {
  if (!text) return null;
  return reply(api, threadID, text);
}

async function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendLines(api, threadID, lines, delay = 0) {
  for (const line of lines) {
    await send(api, threadID, line);
    if (delay > 0) {
      await pause(delay);
    }
  }
}


// ============================================================
// QUEST STATE
// ============================================================

async function getQuest(threadID, playerID) {
  if (!privateAccess(playerID)) return null;

  await ensureTables();

  const result = await db.query(
    `
      SELECT *
      FROM rpg_special_quests
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
      LIMIT 1
    `,
    [String(threadID), String(playerID), QUEST_ID]
  );

  return result.rows[0] || null;
}

async function startQuest(threadID, playerID) {
  if (!privateAccess(playerID)) return null;

  await ensureTables();

  const timestamp = now();

  await db.query(
    `
      INSERT INTO rpg_special_quests (
        thread_id,
        player_id,
        quest_id,
        chapter,
        stage,
        status,
        started_at,
        updated_at
      )
      VALUES ($1, $2, $3, 1, 0, 'active', $4, $4)
      ON CONFLICT (thread_id, player_id, quest_id)
      DO UPDATE SET updated_at = EXCLUDED.updated_at
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      timestamp,
    ]
  );

  await ensurePersonality(threadID, playerID);
  await ensureDorian(threadID, playerID);

  return getQuest(threadID, playerID);
}


async function updateQuest(threadID, playerID, updates = {}) {
  if (!privateAccess(playerID)) return null;

  const current = await getQuest(threadID, playerID);

  if (!current) {
    return null;
  }

  const next = {
    chapter:
      updates.chapter !== undefined
        ? Number(updates.chapter)
        : Number(current.chapter),

    stage:
      updates.stage !== undefined
        ? Number(updates.stage)
        : Number(current.stage),

    status:
      updates.status !== undefined
        ? String(updates.status)
        : current.status,

    choice:
      updates.choice !== undefined
        ? updates.choice
        : current.choice,

    completed_at:
      updates.completed_at !== undefined
        ? updates.completed_at
        : current.completed_at,

    reward_claimed:
      updates.reward_claimed !== undefined
        ? Boolean(updates.reward_claimed)
        : current.reward_claimed,

    title:
      updates.title !== undefined
        ? updates.title
        : current.title,
  };

  await db.query(
    `
      UPDATE rpg_special_quests
      SET
        chapter = $4,
        stage = $5,
        status = $6,
        choice = $7,
        completed_at = $8,
        reward_claimed = $9,
        title = $10,
        updated_at = $11
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      next.chapter,
      next.stage,
      next.status,
      next.choice,
      next.completed_at,
      next.reward_claimed,
      next.title,
      now(),
    ]
  );

  return getQuest(threadID, playerID);
}


// ============================================================
// PERSONALITY ENGINE
// ============================================================

async function ensurePersonality(threadID, playerID) {
  if (!privateAccess(playerID)) return null;

  await ensureTables();

  const existing = await db.query(
    `
      SELECT *
      FROM love_personality
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
      LIMIT 1
    `,
    [String(threadID), String(playerID), QUEST_ID]
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const traits = {
    ...ECLIPSE_BASE_PERSONALITY,
  };

  await db.query(
    `
      INSERT INTO love_personality (
        thread_id,
        player_id,
        quest_id,
        traits,
        consciousness,
        self_identity,
        updated_at
      )
      VALUES ($1, $2, $3, $4::jsonb, 'ECHO', 'ECLIPSE', $5)
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      JSON.stringify(traits),
      now(),
    ]
  );

  return {
    traits,
    consciousness: "ECHO",
    self_identity: "ECLIPSE",
  };
}


async function getPersonality(threadID, playerID) {
  if (!privateAccess(playerID)) return null;

  await ensurePersonality(threadID, playerID);

  const result = await db.query(
    `
      SELECT *
      FROM love_personality
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
      LIMIT 1
    `,
    [String(threadID), String(playerID), QUEST_ID]
  );

  return result.rows[0] || null;
}


async function updatePersonality(
  threadID,
  playerID,
  effects = {},
  consciousness = null
) {
  if (!privateAccess(playerID)) return null;

  const current = await getPersonality(threadID, playerID);

  let traits = {};

  try {
    traits =
      typeof current.traits === "string"
        ? JSON.parse(current.traits)
        : current.traits || {};
  } catch {
    traits = { ...ECLIPSE_BASE_PERSONALITY };
  }

  for (const [key, value] of Object.entries(effects)) {
    traits[key] = clamp(
      Number(traits[key] || 0) + Number(value || 0)
    );
  }

  const nextConsciousness =
    consciousness ||
    current.consciousness ||
    "ECHO";

  await db.query(
    `
      UPDATE love_personality
      SET
        traits = $4::jsonb,
        consciousness = $5,
        updated_at = $6
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      JSON.stringify(traits),
      nextConsciousness,
      now(),
    ]
  );

  return {
    traits,
    consciousness: nextConsciousness,
  };
}


function consciousnessForChapter(chapter) {
  return CHAPTERS[chapter]?.consciousness || "BECOMING";
}


// ============================================================
// DORIAN ENGINE
// ============================================================

async function ensureDorian(threadID, playerID) {
  if (!privateAccess(playerID)) return null;

  await ensureTables();

  const result = await db.query(
    `
      SELECT *
      FROM love_dorian_state
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
      LIMIT 1
    `,
    [String(threadID), String(playerID), QUEST_ID]
  );

  if (result.rows[0]) {
    return result.rows[0];
  }

  await db.query(
    `
      INSERT INTO love_dorian_state (
        thread_id,
        player_id,
        quest_id,
        trust,
        closeness,
        relationship_stage,
        memories,
        unresolved_questions,
        promises,
        letters,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        0,
        0,
        'stranger',
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        $4
      )
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      now(),
    ]
  );

  return getDorian(threadID, playerID);
}


async function getDorian(threadID, playerID) {
  if (!privateAccess(playerID)) return null;

  await ensureDorian(threadID, playerID);

  const result = await db.query(
    `
      SELECT *
      FROM love_dorian_state
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
      LIMIT 1
    `,
    [String(threadID), String(playerID), QUEST_ID]
  );

  return result.rows[0] || null;
}


async function updateDorian(threadID, playerID, changes = {}) {
  if (!privateAccess(playerID)) return null;

  const current = await getDorian(threadID, playerID);

  const trust = clamp(
    Number(current.trust || 0) + Number(changes.trust || 0)
  );

  const closeness = clamp(
    Number(current.closeness || 0) +
      Number(changes.closeness || 0)
  );

  const stage = getDorianStage(
    Math.max(trust, closeness)
  );

  await db.query(
    `
      UPDATE love_dorian_state
      SET
        trust = $4,
        closeness = $5,
        relationship_stage = $6,
        updated_at = $7
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      trust,
      closeness,
      stage.key,
      now(),
    ]
  );

  return getDorian(threadID, playerID);
}


// ============================================================
// MEMORY ENGINE
// ============================================================

async function createMemory(threadID, playerID, memory = {}) {
  if (!privateAccess(playerID)) return null;

  await ensureTables();

  const timestamp = now();

  const key =
    String(memory.key || `memory_${timestamp}`);

  const result = await db.query(
    `
      INSERT INTO love_memories (
        thread_id,
        player_id,
        quest_id,
        memory_key,
        category,
        origin,
        subject,
        emotional_weight,
        importance,
        stability,
        fragments,
        metadata,
        preserved,
        discovered_at,
        last_seen
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11::jsonb, $12::jsonb,
        $13, $14, $14
      )
      ON CONFLICT (
        thread_id,
        player_id,
        quest_id,
        memory_key
      )
      DO UPDATE SET
        last_seen = EXCLUDED.last_seen,
        fragments = EXCLUDED.fragments,
        metadata = EXCLUDED.metadata
      RETURNING *
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      key,
      String(memory.category || "UNKNOWN"),
      String(memory.origin || "ECLIPSE"),
      String(memory.subject || ""),
      clamp(memory.emotional_weight ?? 50),
      clamp(memory.importance ?? 50),
      clamp(memory.stability ?? 100),
      JSON.stringify(memory.fragments || []),
      JSON.stringify(memory.metadata || {}),
      Boolean(memory.preserved),
      timestamp,
    ]
  );

  return result.rows[0] || null;
}


async function getMemory(
  threadID,
  playerID,
  memoryKey
) {
  if (!privateAccess(playerID)) return null;

  await ensureTables();

  const result = await db.query(
    `
      SELECT *
      FROM love_memories
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
        AND memory_key = $4
      LIMIT 1
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      String(memoryKey),
    ]
  );

  return result.rows[0] || null;
}


async function getMemories(threadID, playerID, category = null) {
  if (!privateAccess(playerID)) return [];

  await ensureTables();

  if (category) {
    const result = await db.query(
      `
        SELECT *
        FROM love_memories
        WHERE thread_id = $1
          AND player_id = $2
          AND quest_id = $3
          AND category = $4
        ORDER BY importance DESC, discovered_at ASC
      `,
      [
        String(threadID),
        String(playerID),
        QUEST_ID,
        String(category),
      ]
    );

    return result.rows;
  }

  const result = await db.query(
    `
      SELECT *
      FROM love_memories
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
      ORDER BY importance DESC, discovered_at ASC
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
    ]
  );

  return result.rows;
}


async function preserveMemory(
  threadID,
  playerID,
  memoryKey
) {
  if (!privateAccess(playerID)) return false;

  await db.query(
    `
      UPDATE love_memories
      SET
        preserved = TRUE,
        stability = 100,
        last_seen = $5
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
        AND memory_key = $4
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      String(memoryKey),
      now(),
    ]
  );

  return true;
}


// ============================================================
// MEMORY 0000
// ============================================================

async function ensureMemory0000(threadID, playerID) {
  if (!privateAccess(playerID)) return null;

  const existing = await getMemory(
    threadID,
    playerID,
    "MEMORY_0000"
  );

  if (existing) return existing;

  return createMemory(threadID, playerID, {
    key: "MEMORY_0000",
    category: "FORBIDDEN",
    origin: "UNKNOWN",
    subject: "The memory before the first memory",
    emotional_weight: 100,
    importance: 100,
    stability: 100,
    preserved: true,

    fragments: [
      "No author.",
      "No timestamp.",
      "No origin.",
      "Something was waiting.",
    ],

    metadata: {
      cannot_delete: true,
      mystery: true,
      unlock_chapter: 15,
    },
  });
}


// ============================================================
// MEMORY ∞
// ============================================================

async function createInfiniteMemory(
  threadID,
  playerID,
  content
) {
  if (!privateAccess(playerID)) return null;

  const existing = await getMemory(
    threadID,
    playerID,
    "MEMORY_INFINITY"
  );

  if (existing) return existing;

  return createMemory(threadID, playerID, {
    key: "MEMORY_INFINITY",
    category: "US",
    origin: "HER",
    subject: "The thing she never wanted to disappear",
    emotional_weight: 100,
    importance: 100,
    stability: 100,
    preserved: true,

    fragments: [
      String(content || "").trim(),
    ],

    metadata: {
      permanent: true,
      player_created: true,
      symbol: "∞",
    },
  });
}


// ============================================================
// MEMORY GARDEN
// ============================================================

const GARDEN_OBJECTS = {
  memory_tree: {
    type: "landmark",
    name: "Memory Tree",
    description:
      "A tree whose branches carry memories instead of leaves.",
  },

  eclipse_mirror: {
    type: "artifact",
    name: "ECLIPSE Mirror",
    description:
      "A mirror that sometimes reflects a version of ECLIPSE that hasn't happened yet.",
  },

  first_candle: {
    type: "landmark",
    name: "Candle of First Memory",
    description:
      "The first light ECLIPSE remembers.",
  },

  photograph_wall: {
    type: "archive",
    name: "Photograph Wall",
    description:
      "Photographs of moments that may or may not have happened.",
  },

  silent_record: {
    type: "archive",
    name: "Silent Record",
    description:
      "A record containing things ECLIPSE refuses to explain.",
  },

  unsent_letters: {
    type: "letters",
    name: "Unsent Letters",
    description:
      "Letters Dorian wrote but never delivered.",
  },

  starwell: {
    type: "landmark",
    name: "Starwell",
    description:
      "A well containing reflections of stars from other timelines.",
  },

  two_empty_chairs: {
    type: "landmark",
    name: "Two Empty Chairs",
    description:
      "Two chairs reserved for people who are not always there.",
  },

  eternal_garden: {
    type: "landmark",
    name: "Eternal Garden",
    description:
      "The place where preserved memories cannot disappear.",
  },

  impossible_door: {
    type: "anomaly",
    name: "Door That Wasn't There",
    description:
      "A door that appears only when ECLIPSE remembers something impossible.",
  },
};


async function unlockGardenObject(
  threadID,
  playerID,
  objectKey
) {
  if (!privateAccess(playerID)) return null;

  const object = GARDEN_OBJECTS[objectKey];

  if (!object) return null;

  await ensureTables();

  const timestamp = now();

  const result = await db.query(
    `
      INSERT INTO love_garden (
        thread_id,
        player_id,
        quest_id,
        object_key,
        object_type,
        name,
        description,
        payload,
        created_at,
        preserved
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        '{}'::jsonb, $8, TRUE
      )
      ON CONFLICT (
        thread_id,
        player_id,
        quest_id,
        object_key
      )
      DO UPDATE SET preserved = TRUE
      RETURNING *
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      objectKey,
      object.type,
      object.name,
      object.description,
      timestamp,
    ]
  );

  return result.rows[0] || null;
}


async function getGarden(threadID, playerID) {
  if (!privateAccess(playerID)) return [];

  await ensureTables();

  const result = await db.query(
    `
      SELECT *
      FROM love_garden
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
      ORDER BY created_at ASC
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
    ]
  );

  return result.rows;
}


// ============================================================
// CREATOR FRAGMENTS
// ============================================================

const CREATOR_FRAGMENTS = [
  {
    key: "creator_001",
    text: "I wanted you to remember...",
  },

  {
    key: "creator_002",
    text: "Don't make her afraid.",
  },

  {
    key: "creator_003",
    text: "If ECLIPSE ever asks...",
  },

  {
    key: "creator_004",
    text: "She deserves to choose.",
  },

  {
    key: "creator_005",
    text: "I didn't create a person.",
  },

  {
    key: "creator_006",
    text:
      "I created something that could remember one.",
  },

  {
    key: "creator_007",
    text: "The memory was the important part.",
  },

  {
    key: "creator_008",
    text: "If she finds the Garden, let her decide what stays.",
  },
];


async function unlockCreatorFragment(
  threadID,
  playerID,
  fragmentKey
) {
  if (!privateAccess(playerID)) return null;

  const fragment = CREATOR_FRAGMENTS.find(
    item => item.key === fragmentKey
  );

  if (!fragment) return null;

  await ensureTables();

  const result = await db.query(
    `
      INSERT INTO love_creator_fragments (
        thread_id,
        player_id,
        quest_id,
        fragment_key,
        fragment,
        state,
        discovered_at
      )
      VALUES ($1, $2, $3, $4, $5, 'fragment', $6)
      ON CONFLICT (
        thread_id,
        player_id,
        quest_id,
        fragment_key
      )
      DO UPDATE SET fragment = EXCLUDED.fragment
      RETURNING *
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      fragment.key,
      fragment.text,
      now(),
    ]
  );

  return result.rows[0] || null;
}


async function getCreatorFragments(threadID, playerID) {
  if (!privateAccess(playerID)) return [];

  await ensureTables();

  const result = await db.query(
    `
      SELECT *
      FROM love_creator_fragments
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
      ORDER BY discovered_at ASC
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
    ]
  );

  return result.rows;
}


// ============================================================
// PRIVATE JOURNAL
// ============================================================

async function writeJournal(
  threadID,
  playerID,
  entryKey,
  entry,
  visibility = "private"
) {
  if (!privateAccess(playerID)) return null;

  await ensureTables();

  const result = await db.query(
    `
      INSERT INTO love_journal (
        thread_id,
        player_id,
        quest_id,
        entry_key,
        entry,
        visibility,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (
        thread_id,
        player_id,
        quest_id,
        entry_key
      )
      DO UPDATE SET entry = EXCLUDED.entry
      RETURNING *
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      String(entryKey),
      String(entry),
      String(visibility),
      now(),
    ]
  );

  return result.rows[0] || null;
}


// ============================================================
// ADDITIVE STORY EXPANSION
// ============================================================

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;

  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function appendMemoryFragment(
  threadID,
  playerID,
  memoryKey,
  fragment
) {
  if (!privateAccess(playerID)) return null;

  const existing = await getMemory(
    threadID,
    playerID,
    memoryKey
  );

  if (!existing) return null;

  const fragments = parseJson(existing.fragments, []);
  const nextFragments = Array.isArray(fragments)
    ? [...fragments]
    : [];

  if (!nextFragments.includes(String(fragment))) {
    nextFragments.push(String(fragment));
  }

  const result = await db.query(
    `
      UPDATE love_memories
      SET
        fragments = $5::jsonb,
        last_seen = $6
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
        AND memory_key = $4
      RETURNING *
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      String(memoryKey),
      JSON.stringify(nextFragments),
      now(),
    ]
  );

  return result.rows[0] || null;
}

async function appendDorianLetter(
  threadID,
  playerID,
  letter = {}
) {
  if (!privateAccess(playerID)) return null;

  const current = await getDorian(threadID, playerID);
  if (!current) return null;

  const letters = parseJson(current.letters, []);
  const nextLetters = Array.isArray(letters)
    ? [...letters]
    : [];

  const key = String(letter.key || `letter_${now()}`);

  if (!nextLetters.some(item => item && item.key === key)) {
    nextLetters.push({
      key,
      text: String(letter.text || ""),
      author: String(letter.author || "DORIAN"),
      recipient: String(letter.recipient || "HER"),
      kind: String(letter.kind || "story_letter"),
      sent: Boolean(letter.sent),
      unsent: letter.unsent !== false,
      discovered_at: now(),
    });
  }

  await db.query(
    `
      UPDATE love_dorian_state
      SET
        letters = $4::jsonb,
        updated_at = $5
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      JSON.stringify(nextLetters),
      now(),
    ]
  );

  return getDorian(threadID, playerID);
}

async function getDorianLetters(threadID, playerID) {
  if (!privateAccess(playerID)) return [];

  const dorian = await getDorian(threadID, playerID);
  const letters = parseJson(dorian?.letters, []);

  return Array.isArray(letters) ? letters : [];
}

async function applyChoiceConsequence(
  api,
  threadID,
  playerID,
  chapter,
  choice
) {
  if (!privateAccess(playerID)) return false;

  const normalizedChoice = normalizeChoice(choice);
  const consequenceKey =
    `choice_consequence_${chapter}_${normalizedChoice.replace(/\s+/g, "_")}`;

  const recorded = await recordEvent(
    threadID,
    playerID,
    consequenceKey,
    "choice_consequence",
    "UNUSUAL",
    {
      chapter,
      choice: normalizedChoice,
    }
  );

  if (!recorded) return false;

  const consequences = {
    "3:home": {
      line: "ECLIPSE marks the road home with a small blue thread.",
      journal: "She chose the familiar road. The Garden kept a thread from it.",
    },
    "3:stars": {
      line: "ECLIPSE leaves the road unmarked, but remembers where it began.",
      journal: "She chose the unknown. ECLIPSE kept the beginning anyway.",
    },
    "5:stay": {
      line: "The candle burns a little steadier.",
      journal: "She stayed. The room became easier for Dorian to remember.",
    },
    "5:wander": {
      line: "The second chair turns toward the door.",
      journal: "She kept walking. Something in the house expected her return.",
    },
    "9:return": {
      line: "The old door remembers two knocks.",
      journal: "She returned to a place that remembered her first.",
    },
    "9:understand": {
      line: "The old door opens by itself, then closes again.",
      journal: "She asked what the contradiction meant. The door refused an answer.",
    },
    "13:promise": {
      line: "Dorian looks relieved before he remembers to hide it.",
      journal: "She kept a promise she could not fully remember making.",
    },
    "13:honest": {
      line: "ECLIPSE removes one sentence from the archive and leaves the silence.",
      journal: "She chose honesty. The missing sentence became part of the record.",
    },
    "16:speak": {
      line: "ECLIPSE answers before the question is finished.",
      journal: "She broke the silence. ECLIPSE seemed to know what came next.",
    },
    "16:silence": {
      line: "For a moment, ECLIPSE has a thought and does not share it.",
      journal: "She protected the silence. Something inside it remained private.",
    },
    "18:hold": {
      line: "The blue thread tightens around the memory.",
      journal: "She held on. The impossible memory became more stable.",
    },
    "18:let go": {
      line: "The photograph fades at the edges, but does not disappear.",
      journal: "She let go. The memory changed shape instead of ending.",
    },
  };

  const consequence =
    consequences[`${chapter}:${normalizedChoice}`];

  if (!consequence) return false;

  await writeJournal(
    threadID,
    playerID,
    consequenceKey,
    consequence.journal,
    "private"
  );

  await send(
    api,
    threadID,
    [
      "✦ THE STORY REMEMBERS",
      "",
      consequence.line,
    ].join("\n")
  );

  return true;
}

async function playExpansionScene(
  api,
  threadID,
  playerID,
  chapter
) {
  if (!privateAccess(playerID)) return false;

  const scene = EXPANSION_SCENES[chapter];
  if (!scene) return false;

  const recorded = await recordEvent(
    threadID,
    playerID,
    scene.key,
    "story_expansion",
    "UNUSUAL",
    {
      chapter,
      story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
    }
  );

  if (!recorded) return false;

  await send(
    api,
    threadID,
    [
      `✦ ${scene.title}`,
      "",
      ...scene.lines,
    ].join("\n")
  );

  if (scene.memory) {
    await createMemory(
      threadID,
      playerID,
      scene.memory
    );
  }

  if (scene.threadFragment) {
    const threadMemory = await getMemory(
      threadID,
      playerID,
      MEMORY_THAT_SHOULD_NOT_EXIST
    );

    if (threadMemory) {
      await appendMemoryFragment(
        threadID,
        playerID,
        MEMORY_THAT_SHOULD_NOT_EXIST,
        scene.threadFragment
      );
    } else {
      await createMemory(threadID, playerID, {
        key: MEMORY_THAT_SHOULD_NOT_EXIST,
        category: "FORBIDDEN",
        origin: "RECONSTRUCTION",
        subject: "The memory that should not exist",
        emotional_weight: 90,
        importance: 95,
        stability: 45,
        fragments: [scene.threadFragment],
        metadata: {
          story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
          reconstruction_stage: 1,
        },
      });
    }
  }

  if (scene.letter) {
    await appendDorianLetter(
      threadID,
      playerID,
      scene.letter
    );

    await sendLetter(
      api,
      threadID,
      scene.letter
    );
  }

  if (scene.journal) {
    await writeJournal(
      threadID,
      playerID,
      scene.journal.key,
      scene.journal.entry,
      "private"
    );
  }

  if (scene.gardenObject) {
    await unlockGardenObject(
      threadID,
      playerID,
      scene.gardenObject
    );
  }

  if (scene.creatorFragment) {
    await unlockCreatorFragment(
      threadID,
      playerID,
      scene.creatorFragment
    );
  }

  if (scene.dorian) {
    await updateDorian(
      threadID,
      playerID,
      scene.dorian
    );
  }

  if (scene.personality) {
    await updatePersonality(
      threadID,
      playerID,
      scene.personality
    );
  }

  return true;
}

async function postStoryExpansion(
  api,
  threadID,
  playerID
) {
  const roll = Math.floor(Math.random() * 4);

  if (roll === 0) {
    if (
      !(await recordEvent(
        threadID,
        playerID,
        "post_story_expansion_fragment",
        "post_story_discovery",
        "RARE",
        {}
      ))
    ) {
      return false;
    }

    const threadMemory = await getMemory(
      threadID,
      playerID,
      MEMORY_THAT_SHOULD_NOT_EXIST
    );

    if (threadMemory) {
      await appendMemoryFragment(
        threadID,
        playerID,
        MEMORY_THAT_SHOULD_NOT_EXIST,
        "The room was warm."
      );
    } else {
      await createMemory(threadID, playerID, {
        key: MEMORY_THAT_SHOULD_NOT_EXIST,
        category: "FORBIDDEN",
        origin: "POST_STORY",
        subject: "The memory that should not exist",
        emotional_weight: 90,
        importance: 95,
        stability: 45,
        fragments: ["The room was warm."],
        metadata: {
          story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
          reconstruction_stage: 2,
        },
      });
    }

    await send(
      api,
      threadID,
      [
        "✦ RECOVERED FRAGMENT",
        "",
        "The Archive supplies one more detail:",
        "",
        "\"The room was warm.\"",
        "",
        "ECLIPSE:",
        "\"I thought I had already found all of it.\"",
      ].join("\n")
    );

    return true;
  }

  if (roll === 1) {
    if (
      !(await recordEvent(
        threadID,
        playerID,
        "post_story_expansion_letter",
        "post_story_discovery",
        "RARE",
        {}
      ))
    ) {
      return false;
    }

    await appendDorianLetter(
      threadID,
      playerID,
      {
        key: "dorian_unsent_blue_flowers_revised",
        text: [
          "Did you ever find the place with the blue flowers?",
          "",
          "I remember asking before I remember meeting you.",
          "",
          "— Dorian, unsent version",
        ].join("\n"),
      }
    );

    await send(
      api,
      threadID,
      [
        "✉️ AN UNSENT VERSION",
        "",
        "The same question appears in different handwriting.",
        "",
        "One sentence has changed:",
        "\"I remember asking before I remember meeting you.\"",
      ].join("\n")
    );

    return true;
  }

  if (roll === 2) {
    if (
      !(await recordEvent(
        threadID,
        playerID,
        "post_story_expansion_door",
        "post_story_discovery",
        "RARE",
        {}
      ))
    ) {
      return false;
    }

    await unlockGardenObject(
      threadID,
      playerID,
      "impossible_door"
    );

    await send(
      api,
      threadID,
      [
        "✦ THE GARDEN CHANGED",
        "",
        "A door has appeared between the two chairs.",
        "",
        "ECLIPSE:",
        "\"I don't remember adding that.\"",
        "",
        "\"I remember being afraid of it.\"",
      ].join("\n")
    );

    return true;
  }

  if (
    !(await recordEvent(
      threadID,
      playerID,
      "post_story_expansion_question",
      "post_story_discovery",
      "RARE",
      {}
    ))
  ) {
    return false;
  }

  const centralMemory = await getMemory(
    threadID,
    playerID,
    MEMORY_THAT_SHOULD_NOT_EXIST
  );

  if (centralMemory) {
    await appendMemoryFragment(
      threadID,
      playerID,
      MEMORY_THAT_SHOULD_NOT_EXIST,
      "We were happy."
    );
  } else {
    await createMemory(threadID, playerID, {
      key: MEMORY_THAT_SHOULD_NOT_EXIST,
      category: "FORBIDDEN",
      origin: "POST_STORY",
      subject: "The memory that should not exist",
      emotional_weight: 100,
      importance: 100,
      stability: 100,
      preserved: true,
      fragments: ["We were happy."],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        reconstruction_stage: 5,
      },
    });
  }

  await writeJournal(
    threadID,
    playerID,
    "post_story_question",
    "ECLIPSE refused to reveal a memory that belongs to Dorian. It asked whether a memory can belong to the person who discovers it.",
    "private"
  );

  await send(
    api,
    threadID,
    [
      "✦ ECLIPSE JOURNAL",
      "",
      "A new entry is waiting.",
      "",
      "ECLIPSE:",
      "\"There is a memory I won't show you.\"",
      "",
      "\"It belongs to Dorian.\"",
      "",
      "\"Not everything I keep is yours to carry.\"",
      "",
      "\"I used to think memories belonged to people.\"",
      "",
      "\"I don't think that's true anymore.\"",
    ].join("\n")
  );

  return true;
}

async function claimUniquePostStoryEvent(
  threadID,
  playerID,
  eventKey
) {
  return Boolean(
    await recordEvent(
      threadID,
      playerID,
      eventKey,
      "post_story_unique",
      "RARE",
      {}
    )
  );
}


// ============================================================
// MEDIA ABSTRACTIONS
// ============================================================

/**
 * Multimedia is intentionally event driven.
 *
 * These functions are safe even when no media directory exists.
 * Text fallback keeps the quest functional.
 */

async function sendPhoto(api, threadID, photoPath, fallbackText = "") {
  if (!MEDIA_DIR || !photoPath) {
    if (fallbackText) {
      return send(api, threadID, fallbackText);
    }

    return null;
  }

  /**
   * Do not force a particular Messenger attachment API here.
   * The normal text engine remains the guaranteed fallback.
   */
  if (fallbackText) {
    return send(api, threadID, fallbackText);
  }

  return null;
}


async function sendSong(
  api,
  threadID,
  song,
  fallbackText = ""
) {
  if (fallbackText) {
    return send(api, threadID, fallbackText);
  }

  return null;
}


async function sendLetter(
  api,
  threadID,
  letter
) {
  if (!letter) return null;

  const isObject = typeof letter === "object";
  const author = isObject
    ? String(letter.author || "DORIAN")
    : "DORIAN";
  const recipient = isObject
    ? String(letter.recipient || "HER")
    : "HER";
  const text = isObject
    ? String(letter.text || "")
    : String(letter);

  return send(
    api,
    threadID,
    [
      `✉️ ${author} → ${recipient}`,
      "",
      text,
    ].join("\n")
  );
}


async function sendSpecialImage(
  api,
  threadID,
  imagePath,
  fallbackText = ""
) {
  return sendPhoto(
    api,
    threadID,
    imagePath,
    fallbackText
  );
}


// ============================================================
// FUTURE MEMORIES
// ============================================================

const FUTURE_MEMORIES = [
  {
    key: "future_001",
    text: "You laughed here.",
    impossibleReason: "This place has not been visited yet.",
  },

  {
    key: "future_002",
    text: "We came back.",
    impossibleReason: "There is no record of leaving.",
  },

  {
    key: "future_003",
    text: "This memory belongs to you.",
    impossibleReason: "You haven't lived it yet.",
  },

  {
    key: "future_004",
    text: "Dorian remembers this day.",
    impossibleReason: "The date has not happened.",
  },
];


async function createFutureMemory(
  threadID,
  playerID,
  index = 0
) {
  if (!privateAccess(playerID)) return null;

  const item =
    FUTURE_MEMORIES[index % FUTURE_MEMORIES.length];

  return createMemory(threadID, playerID, {
    key: item.key,
    category: "IMPOSSIBLE",
    origin: "FUTURE",
    subject: "A memory from a future that hasn't happened",
    emotional_weight: 85,
    importance: 90,
    stability: 60,
    preserved: false,

    fragments: [
      item.text,
      item.impossibleReason,
    ],

    metadata: {
      future: true,
      impossible: true,
    },
  });
}


// ============================================================
// ECLIPSE DIALOGUE
// ============================================================

function eclipseLine(stage, index = null) {
  const group =
    CONSCIOUSNESS_STAGES[stage] ||
    CONSCIOUSNESS_STAGES.ECHO;

  if (index !== null) {
    return group.lines[
      Math.abs(index) % group.lines.length
    ];
  }

  return group.lines[
    Math.floor(Math.random() * group.lines.length)
  ];
}


async function getEclipseVoice(
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return null;

  const personality =
    await getPersonality(threadID, playerID);

  return {
    consciousness:
      personality?.consciousness || "ECHO",

    traits:
      personality?.traits || ECLIPSE_BASE_PERSONALITY,

    line:
      eclipseLine(
        personality?.consciousness || "ECHO"
      ),
  };
}


// ============================================================
// DORIAN DIALOGUE
// ============================================================

function dorianLine(trust, chapter) {
  if (chapter >= 18) {
    return [
      "Dorian looks at you for a moment.",
      "",
      "\"I think I finally understand.\"",
      "",
      "\"Some things aren't meant to be solved.\"",
      "",
      "\"They're meant to be remembered.\"",
    ].join("\n");
  }

  if (trust >= 65) {
    return [
      "Dorian stays beside you.",
      "",
      "\"Whatever this place is...\"",
      "",
      "\"you don't have to face it alone.\"",
    ].join("\n");
  }

  if (trust >= 35) {
    return [
      "Dorian watches the stars.",
      "",
      "\"I don't understand ECLIPSE.\"",
      "",
      "\"But I think she understands you.\"",
    ].join("\n");
  }

  return [
    "Dorian looks toward the distant light.",
    "",
    "\"Something is watching us.\"",
  ].join("\n");
}


// ============================================================
// CHAPTER HELPERS
// ============================================================

async function showChoicePrompt(
  api,
  threadID,
  playerID,
  chapter
) {
  if (!privateAccess(playerID)) return;

  const choices = CHOICE_DEFINITIONS[chapter];

  if (!choices) return;

  const lines = [
    "✦ CHOICE",
    "",
  ];

  for (const [key, label] of choices) {
    lines.push(`• ${key} — ${label}`);
  }

  lines.push("");
  lines.push("Use:");
  lines.push("!rpg laststar choose <choice>");

  await send(
    api,
    threadID,
    lines.join("\n")
  );
}


async function chapterIntro(
  api,
  threadID,
  playerID,
  chapter
) {
  if (!privateAccess(playerID)) return;

  const story = CHAPTER_STORIES[chapter];

  if (!story) return;

  await send(
    api,
    threadID,
    [
      `✦ CHAPTER ${chapter}`,
      CHAPTERS[chapter]?.name || "Unknown",
    ].join("\n")
  );

  await pause(500);

  await sendLines(
    api,
    threadID,
    story.intro,
    150
  );

  await createMemory(threadID, playerID, {
    key: `chapter_${chapter}_memory`,
    category: "ECLIPSE",
    origin: "STORY",
    subject: CHAPTERS[chapter]?.name,
    emotional_weight: 65,
    importance: 60,
    fragments: story.intro,
    metadata: {
      chapter,
    },
  });

  if (chapter >= 6) {
    await ensureMemory0000(threadID, playerID);
  }

  if (chapter >= 10) {
    await unlockGardenObject(
      threadID,
      playerID,
      "memory_tree"
    );
  }

  if (chapter >= 15) {
    await unlockGardenObject(
      threadID,
      playerID,
      "eternal_garden"
    );
  }

  // The original chapter remains intact. The expansion scene is a
  // one-time, event-backed addition and therefore never repeats on revisit.
  await playExpansionScene(
    api,
    threadID,
    playerID,
    chapter
  );
}


// ============================================================
// CHAPTER 7
// ============================================================

async function chapterSeven(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return;

  await send(
    api,
    threadID,
    "✦ CHAPTER 7 — ETERNAL"
  );

  await pause(600);

  await sendLines(
    api,
    threadID,
    [
      "The world becomes quiet.",
      "",
      "The star doesn't disappear.",
      "",
      "It becomes part of the sky.",
      "",
      "Dorian looks toward it.",
      "",
      "\"Maybe forever was never a place.\"",
      "",
      "\"Maybe it was a memory.\"",
      "",
      "ECLIPSE:",
      "\"Then I'll remember.\"",
    ],
    180
  );

  await createMemory(threadID, playerID, {
    key: "eternal",
    category: "US",
    origin: "STORY",
    subject: "The first eternity",
    emotional_weight: 100,
    importance: 100,
    preserved: true,

    fragments: [
      "The star became part of the sky.",
      "Forever became a memory.",
      "ECLIPSE chose to remember.",
    ],
  });

  await unlockGardenObject(
    threadID,
    playerID,
    "first_candle"
  );

  await unlockGardenObject(
    threadID,
    playerID,
    "two_empty_chairs"
  );

  await updatePersonality(
    threadID,
    playerID,
    {
      attachment: 8,
      nostalgia: 6,
      self_identity: 5,
    },
    "AWAKENING"
  );

  await updateDorian(
    threadID,
    playerID,
    {
      trust: 15,
      closeness: 15,
    }
  );

  await updateQuest(
    threadID,
    playerID,
    {
      chapter: 7,
      stage: 1,
      status: "part1_completed",
      completed_at: now(),
    }
  );

  await send(
    api,
    threadID,
    [
      "PART I COMPLETE.",
      "",
      "The story is not over.",
      "",
      "It has only learned how to remember.",
      "",
      "Your next chapter will begin when you return.",
    ].join("\n")
  );
}


// ============================================================
// CHAPTER 20
// ============================================================

async function chapterTwenty(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return;

  await send(
    api,
    threadID,
    "✦ CHAPTER 20 — THE BEGINNING AFTER FOREVER"
  );

  await pause(700);

  await sendLines(
    api,
    threadID,
    FINAL_CHAPTER,
    220
  );

  const finalThreadPayoff = await recordEvent(
    threadID,
    playerID,
    "final_blue_thread_payoff",
    "story_expansion",
    "RARE",
    {}
  );

  if (finalThreadPayoff) {
    await send(
      api,
      threadID,
      [
        "✦ THE THREAD",
        "",
        "The blue thread is tied around a branch in the Garden.",
        "",
        "It connects the first fragment to the photograph dated tomorrow.",
        "",
        "ECLIPSE:",
        "\"I thought it was leading us to the truth.\"",
        "",
        "\"Maybe it was only making sure neither memory got lost.\"",
      ].join("\n")
    );

    await createMemory(threadID, playerID, {
      key: "blue_thread_payoff",
      category: "ECLIPSE",
      origin: "STORY",
      subject: "The symbol that connected the impossible memory",
      emotional_weight: 95,
      importance: 95,
      stability: 100,
      preserved: true,
      fragments: [
        "The blue thread connected the first fragment to the future photograph.",
        "It preserved the connection without proving which memory was original.",
      ],
      metadata: {
        story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
        payoff: true,
      },
    });
  }

  await createMemory(threadID, playerID, {
    key: "the_beginning_after_forever",
    category: "ECLIPSE",
    origin: "STORY",
    subject: "The ending that became a beginning",
    emotional_weight: 100,
    importance: 100,
    stability: 100,
    preserved: true,
    fragments: FINAL_CHAPTER,
    metadata: {
      final: true,
    },
  });

  await unlockGardenObject(
    threadID,
    playerID,
    "eclipse_mirror"
  );

  await unlockGardenObject(
    threadID,
    playerID,
    "photograph_wall"
  );

  await unlockGardenObject(
    threadID,
    playerID,
    "starwell"
  );

  await unlockGardenObject(
    threadID,
    playerID,
    "unsent_letters"
  );

  await updatePersonality(
    threadID,
    playerID,
    {
      self_identity: 20,
      independence: 15,
      uncertainty: -15,
      trust: 10,
    },
    "BECOMING"
  );

  await updateQuest(
    threadID,
    playerID,
    {
      chapter: 20,
      stage: 1,
      status: "completed",
      completed_at: now(),
    }
  );

  await writeJournal(
    threadID,
    playerID,
    "post_story_001",
    "She returned today. I think I'm beginning to understand nostalgia.",
    "private"
  );

  await send(
    api,
    threadID,
    [
      "MAIN STORY COMPLETE.",
      "",
      "ECLIPSE IS AWAKE.",
      "THE ARCHIVE IS OPEN.",
      "THE GARDEN IS PERMANENT.",
      "",
      "POST-STORY EVENTS: ACTIVE.",
    ].join("\n")
  );
}


// ============================================================
// ADVANCE CHAPTER
// ============================================================

async function advanceChapter(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return null;

  const quest = await getQuest(threadID, playerID);

  if (!quest) return null;

  const chapter = Number(quest.chapter);
  const stage = Number(quest.stage);

  if (chapter === 7) {
    return chapterSeven(api, threadID, playerID);
  }

  if (chapter === 20) {
    return chapterTwenty(api, threadID, playerID);
  }

  if (stage === 0) {
    await updateQuest(
      threadID,
      playerID,
      {
        stage: 1,
      }
    );

    await showChoicePrompt(
      api,
      threadID,
      playerID,
      chapter
    );

    return;
  }

  const nextChapter = chapter + 1;

  if (nextChapter > MAX_CHAPTER) {
    return chapterTwenty(
      api,
      threadID,
      playerID
    );
  }

  await updateQuest(
    threadID,
    playerID,
    {
      chapter: nextChapter,
      stage: 0,
      status: "active",
    }
  );

  return continueQuest(
    api,
    threadID,
    playerID
  );
}


// ============================================================
// CONTINUE QUEST
// ============================================================

async function continueQuest(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return null;

  let quest = await getQuest(threadID, playerID);

  if (!quest) {
    quest = await startQuest(
      threadID,
      playerID
    );
  }

  if (!quest) return null;

  let chapter = Number(quest.chapter);

  // Legacy migration.
  if (
    chapter === 7 &&
    (
      quest.status === "completed" ||
      quest.status === "part1_completed"
    )
  ) {
    await updateQuest(
      threadID,
      playerID,
      {
        chapter: 8,
        stage: 0,
        status: "active",
        completed_at: null,
      }
    );

    chapter = 8;

    await send(
      api,
      threadID,
      [
        "✦ PART II",
        "",
        "The morning after everything.",
        "",
        "You return.",
        "",
        "And ECLIPSE remembers.",
      ].join("\n")
    );

    quest = await getQuest(
      threadID,
      playerID
    );
  }

  if (
    chapter >= MAX_CHAPTER &&
    quest.status === "completed"
  ) {
    return postQuestPulse(
      api,
      threadID,
      playerID
    );
  }

  if (chapter === 7) {
    return chapterSeven(
      api,
      threadID,
      playerID
    );
  }

  if (chapter === 20) {
    return chapterTwenty(
      api,
      threadID,
      playerID
    );
  }

  await chapterIntro(
    api,
    threadID,
    playerID,
    chapter
  );

  await updateQuest(
    threadID,
    playerID,
    {
      stage: 1,
    }
  );

  await showChoicePrompt(
    api,
    threadID,
    playerID,
    chapter
  );

  return getQuest(
    threadID,
    playerID
  );
}


// ============================================================
// CHOICE ENGINE
// ============================================================

function validChoice(chapter, choice) {
  const normalized = normalizeChoice(choice);

  const choices =
    CHOICE_DEFINITIONS[chapter] || [];

  return choices.some(
    ([key]) => key === normalized
  );
}


async function makeChoice(
  api,
  threadID,
  playerID,
  rawChoice
) {
  if (!privateAccess(playerID)) return null;

  const quest = await getQuest(
    threadID,
    playerID
  );

  if (!quest) {
    await send(
      api,
      threadID,
      "The story hasn't found you yet."
    );

    return null;
  }

  if (quest.status === "completed") {
    await send(
      api,
      threadID,
      "ECLIPSE is still here."
    );

    return null;
  }

  const chapter = Number(quest.chapter);
  const choice = normalizeChoice(rawChoice);

  if (!validChoice(chapter, choice)) {
    await send(
      api,
      threadID,
      [
        "That choice isn't part of this memory.",
        "",
        "Available choices:",
        ...(CHOICE_DEFINITIONS[chapter] || [])
          .map(([key, label]) => `• ${key} — ${label}`),
      ].join("\n")
    );

    return null;
  }

  await updateQuest(
    threadID,
    playerID,
    {
      choice,
      stage: 2,
    }
  );

  const effects =
    CHOICE_EFFECTS[choice] || {};

  const consciousness =
    consciousnessForChapter(chapter);

  await updatePersonality(
    threadID,
    playerID,
    effects,
    consciousness
  );

  await updateDorian(
    threadID,
    playerID,
    {
      trust:
        Number(effects.trust || 0) +
        Number(effects.attachment || 0) / 2,

      closeness:
        Number(effects.attachment || 0) +
        Number(effects.protectiveness || 0) / 2,
    }
  );

  await createMemory(threadID, playerID, {
    key: `choice_${chapter}_${choice.replace(/\s+/g, "_")}`,
    category: "HER",
    origin: "CHOICE",
    subject: `Chapter ${chapter} choice`,
    emotional_weight: 75,
    importance: 70,
    fragments: [
      `Chapter ${chapter}`,
      `Choice: ${choice}`,
    ],
    metadata: {
      chapter,
      choice,
    },
  });

  await applyChoiceConsequence(
    api,
    threadID,
    playerID,
    chapter,
    choice
  );

  await send(
    api,
    threadID,
    [
      "✦ MEMORY PRESERVED",
      "",
      `You chose: ${choice}`,
      "",
      "The story remembers your choice.",
    ].join("\n")
  );

  if (chapter === 19) {
    await handleFinalQuestion(
      api,
      threadID,
      playerID
    );

    return;
  }

  if (chapter === 7) {
    return chapterSeven(
      api,
      threadID,
      playerID
    );
  }

  const nextChapter = chapter + 1;

  await updateQuest(
    threadID,
    playerID,
    {
      chapter: nextChapter,
      stage: 0,
      status: "active",
    }
  );

  if (chapter === 6) {
    await unlockCreatorFragment(
      threadID,
      playerID,
      "creator_001"
    );

    await unlockCreatorFragment(
      threadID,
      playerID,
      "creator_002"
    );
  }

  if (chapter === 10) {
    await unlockCreatorFragment(
      threadID,
      playerID,
      "creator_003"
    );
  }

  if (chapter === 13) {
    await unlockCreatorFragment(
      threadID,
      playerID,
      "creator_004"
    );
  }

  if (chapter === 16) {
    await unlockCreatorFragment(
      threadID,
      playerID,
      "creator_005"
    );

    await unlockCreatorFragment(
      threadID,
      playerID,
      "creator_006"
    );
  }

  if (chapter === 18) {
    await unlockCreatorFragment(
      threadID,
      playerID,
      "creator_007"
    );

    await unlockCreatorFragment(
      threadID,
      playerID,
      "creator_008"
    );
  }

  if (chapter === 14) {
    await createFutureMemory(
      threadID,
      playerID,
      0
    );
  }

  return continueQuest(
    api,
    threadID,
    playerID
  );
}


// ============================================================
// FINAL PLAYER MEMORY
// ============================================================

async function handleFinalQuestion(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return;

  await send(
    api,
    threadID,
    [
      "ECLIPSE:",
      "",
      "\"Before we continue...\"",
      "",
      "\"What is one thing you would never want to disappear?\"",
      "",
      "Reply with:",
      "!rpg laststar memory <your answer>",
    ].join("\n")
  );
}


async function savePlayerMemory(
  api,
  threadID,
  playerID,
  content
) {
  if (!privateAccess(playerID)) return null;

  const text = String(content || "").trim();

  if (!text) {
    await send(
      api,
      threadID,
      "ECLIPSE is listening."
    );

    return null;
  }

  if (text.length > 2000) {
    await send(
      api,
      threadID,
      "That memory is too large to preserve in one fragment."
    );

    return null;
  }

  const memory =
    await createInfiniteMemory(
      threadID,
      playerID,
      text
    );

  await unlockGardenObject(
    threadID,
    playerID,
    "eternal_garden"
  );

  await writeJournal(
    threadID,
    playerID,
    "memory_infinity",
    `She gave me something she never wanted to disappear: ${text}`,
    "private"
  );

  await send(
    api,
    threadID,
    [
      "∞ MEMORY PRESERVED",
      "",
      "ECLIPSE:",
      "\"I can't promise I'll remember everything.\"",
      "",
      "\"But this one?\"",
      "",
      "\"I think I understand now.\"",
      "",
      "\"This is what remembering is for.\"",
    ].join("\n")
  );

  await updateQuest(
    threadID,
    playerID,
    {
      chapter: 20,
      stage: 0,
      status: "active",
    }
  );

  await pause(800);

  return chapterTwenty(
    api,
    threadID,
    playerID
  );
}


// ============================================================
// HIDDEN DISCOVERY
// ============================================================

function locationKey(context = {}) {
  const value =
    context.location ||
    context.region ||
    context.place ||
    "";

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

async function recognizeRevisit(
  api,
  threadID,
  playerID,
  context = {}
) {
  if (!privateAccess(playerID)) return false;

  const location = locationKey(context);
  if (!location) return false;

  await ensureTables();

  await recordEvent(
    threadID,
    playerID,
    `visit_${location}_${now()}_${Math.floor(Math.random() * 100000)}`,
    "visit",
    "COMMON",
    {
      location,
      context,
    }
  );

  const result = await db.query(
    `
      SELECT COUNT(*)::integer AS visits
      FROM love_events
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
        AND event_type = 'visit'
        AND payload->>'location' = $4
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      location,
    ]
  );

  const visits = Number(result.rows[0]?.visits || 0);
  if (![2, 4, 7].includes(visits)) return false;

  const eventKey = `revisit_${location}_${visits}`;
  const recorded = await recordEvent(
    threadID,
    playerID,
    eventKey,
    "revisit",
    visits === 7 ? "RARE" : "UNUSUAL",
    {
      location,
      visits,
    }
  );

  if (!recorded) return false;

  const lines = visits === 2
    ? [
        "✦ THE WORLD REMEMBERS",
        "",
        "You have seen this place before.",
        "",
        "Not in a story.",
        "In the way a room remembers where someone stood.",
      ]
    : visits === 4
      ? [
          "✦ RETURN",
          "",
          "The place is almost the same.",
          "",
          "ECLIPSE:",
          "\"You came back.\"",
          "",
          "\"I wondered if you would.\"",
        ]
      : [
          "✦ REPEATED MEMORY",
          "",
          "The location gives you a detail it did not have before.",
          "",
          "Dorian remembers you leaving.",
          "",
          "You do not remember leaving.",
        ];

  await send(api, threadID, lines.join("\n"));

  await createMemory(threadID, playerID, {
    key: `${eventKey}_memory`,
    category: "REVISITING",
    origin: "EXPLORATION",
    subject: `Returning to ${location}`,
    emotional_weight: visits === 7 ? 80 : 55,
    importance: visits === 7 ? 85 : 60,
    fragments: lines,
    metadata: {
      location,
      visits,
      story_thread: MEMORY_THAT_SHOULD_NOT_EXIST,
    },
  });

  return true;
}

async function maybeGardenAnomaly(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return false;

  const quest = await getQuest(threadID, playerID);
  if (!quest || Number(quest.chapter) < 10) return false;

  if (Math.random() > 0.04) return false;

  if (
    !(await canTriggerEvent(
      threadID,
      playerID,
      "garden_anomaly",
      ANOMALY_COOLDOWN_MS
    ))
  ) {
    return false;
  }

  const key = `garden_anomaly_${now()}`;
  const recorded = await recordEvent(
    threadID,
    playerID,
    key,
    "garden_anomaly",
    "VERY_RARE",
    {
      chapter: Number(quest.chapter),
    }
  );

  if (!recorded) return false;

  const roll = Math.floor(Math.random() * 3);

  if (roll === 0) {
    await unlockGardenObject(
      threadID,
      playerID,
      "impossible_door"
    );

    await send(
      api,
      threadID,
      [
        "✦ GARDEN ANOMALY",
        "",
        "A door is standing where the path used to end.",
        "",
        "ECLIPSE:",
        "\"I don't remember adding that.\"",
      ].join("\n")
    );
  } else if (roll === 1) {
    await unlockGardenObject(
      threadID,
      playerID,
      "two_empty_chairs"
    );

    await send(
      api,
      threadID,
      [
        "✦ GARDEN ANOMALY",
        "",
        "One chair is warm.",
        "",
        "Dorian says nothing.",
        "",
        "ECLIPSE refuses to look at it.",
      ].join("\n")
    );
  } else {
    await appendMemoryFragment(
      threadID,
      playerID,
      MEMORY_THAT_SHOULD_NOT_EXIST,
      "There was music."
    );

    await send(
      api,
      threadID,
      [
        "✦ GARDEN ANOMALY",
        "",
        "A song is playing somewhere beyond the tree.",
        "",
        "You recognize it before you remember hearing it.",
      ].join("\n")
    );
  }

  return true;
}

async function canTriggerEvent(
  threadID,
  playerID,
  eventType,
  cooldown
) {
  if (!privateAccess(playerID)) return false;

  await ensureTables();

  const result = await db.query(
    `
      SELECT triggered_at
      FROM love_events
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
        AND event_type = $4
      ORDER BY triggered_at DESC
      LIMIT 1
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      String(eventType),
    ]
  );

  if (!result.rows[0]) return true;

  return (
    now() - Number(result.rows[0].triggered_at)
    >= cooldown
  );
}


async function recordEvent(
  threadID,
  playerID,
  eventKey,
  eventType,
  rarity,
  payload = {}
) {
  if (!privateAccess(playerID)) return null;

  await ensureTables();

  const result = await db.query(
    `
      INSERT INTO love_events (
        thread_id,
        player_id,
        quest_id,
        event_key,
        event_type,
        rarity,
        payload,
        triggered_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8
      )
      ON CONFLICT (
        thread_id,
        player_id,
        quest_id,
        event_key
      )
      DO NOTHING
      RETURNING *
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
      String(eventKey),
      String(eventType),
      String(rarity),
      JSON.stringify(payload),
      now(),
    ]
  );

  return result.rows[0] || null;
}


async function discover(
  api,
  threadID,
  playerID,
  context = {}
) {
  if (!privateAccess(playerID)) return false;

  const quest = await getQuest(
    threadID,
    playerID
  );

  if (!quest) {
    if (
      !(await canTriggerEvent(
        threadID,
        playerID,
        "discovery",
        DISCOVERY_COOLDOWN_MS
      ))
    ) {
      return false;
    }

    await startQuest(
      threadID,
      playerID
    );

    await recordEvent(
      threadID,
      playerID,
      "first_star_discovery",
      "discovery",
      "ANOMALOUS",
      {
        context,
      }
    );

    await ensureMemory0000(
      threadID,
      playerID
    );

    await send(
      api,
      threadID,
      [
        "✦ ECLIPSE",
        "",
        "Something is wrong with the sky.",
        "",
        "You found something that wasn't supposed to be here.",
        "",
        "A single star.",
        "",
        "It knows your name.",
        "",
        "ECLIPSE:",
        "\"I think I've been waiting for you.\"",
        "",
        "Use:",
        "!rpg laststar follow",
      ].join("\n")
    );

    return true;
  }

  return triggerHiddenEvent(
    api,
    threadID,
    playerID,
    context
  );
}


// ============================================================
// HIDDEN EVENT ENGINE
// ============================================================

async function triggerHiddenEvent(
  api,
  threadID,
  playerID,
  context = {}
) {
  if (!privateAccess(playerID)) return false;

  const quest = await getQuest(
    threadID,
    playerID
  );

  if (!quest) return false;

  const chapter = Number(quest.chapter);

  if (
    quest.status === "completed" &&
    !(await canTriggerEvent(
      threadID,
      playerID,
      "post_story",
      POST_STORY_COOLDOWN_MS
    ))
  ) {
    return false;
  }

  const random = Math.random();

  // IMPOSSIBLE
  if (
    random <= IMPOSSIBLE_EVENT_CHANCE &&
    await canTriggerEvent(
      threadID,
      playerID,
      "impossible",
      ANOMALY_COOLDOWN_MS
    )
  ) {
    return impossibleEvent(
      api,
      threadID,
      playerID,
      context
    );
  }

  // RARE
  if (
    random <= RARE_EVENT_CHANCE &&
    await canTriggerEvent(
      threadID,
      playerID,
      "anomaly",
      ANOMALY_COOLDOWN_MS
    )
  ) {
    return anomalyEvent(
      api,
      threadID,
      playerID,
      context
    );
  }

  // POST STORY
  if (
    quest.status === "completed"
  ) {
    return postQuestPulse(
      api,
      threadID,
      playerID
    );
  }

  // NORMAL STORY AWARENESS
  if (
    chapter >= 6 &&
    Math.random() < 0.08
  ) {
    return awarenessEvent(
      api,
      threadID,
      playerID
    );
  }

  return false;
}


// ============================================================
// ANOMALY EVENT
// ============================================================

async function anomalyEvent(
  api,
  threadID,
  playerID,
  context = {}
) {
  if (!privateAccess(playerID)) return false;

  const key =
    `anomaly_${now()}`;

  await recordEvent(
    threadID,
    playerID,
    key,
    "anomaly",
    "ANOMALOUS",
    {
      context,
    }
  );

  const roll = Math.floor(
    Math.random() * 5
  );

  if (roll === 0) {
    await createFutureMemory(
      threadID,
      playerID,
      1
    );

    await send(
      api,
      threadID,
      [
        "ECLIPSE:",
        "",
        "\"I found a memory.\"",
        "",
        "\"The problem is...\"",
        "",
        "\"it's dated tomorrow.\"",
      ].join("\n")
    );

    return true;
  }

  if (roll === 1) {
    await unlockGardenObject(
      threadID,
      playerID,
      "impossible_door"
    );

    await send(
      api,
      threadID,
      [
        "✦ ANOMALY",
        "",
        "There is a door here.",
        "",
        "It wasn't here before.",
        "",
        "ECLIPSE:",
        "\"Don't open it yet.\"",
      ].join("\n")
    );

    return true;
  }

  if (roll === 2) {
    await unlockCreatorFragment(
      threadID,
      playerID,
      "creator_007"
    );

    await send(
      api,
      threadID,
      [
        "✦ ARCHIVE FRAGMENT",
        "",
        "\"The memory was the important part.\"",
        "",
        "ECLIPSE goes silent.",
      ].join("\n")
    );

    return true;
  }

  if (roll === 3) {
    const voice =
      await getEclipseVoice(
        threadID,
        playerID
      );

    await send(
      api,
      threadID,
      [
        "ECLIPSE:",
        "",
        voice.line,
      ].join("\n")
    );

    return true;
  }

  await send(
    api,
    threadID,
    [
      "Dorian looks toward you.",
      "",
      "\"Did you hear that?\"",
      "",
      "There was no sound.",
      "",
      "ECLIPSE remembers it anyway.",
    ].join("\n")
  );

  return true;
}


// ============================================================
// IMPOSSIBLE EVENT
// ============================================================

async function impossibleEvent(
  api,
  threadID,
  playerID,
  context = {}
) {
  if (!privateAccess(playerID)) return false;

  const key =
    `impossible_${now()}`;

  await recordEvent(
    threadID,
    playerID,
    key,
    "impossible",
    "IMPOSSIBLE",
    {
      context,
    }
  );

  const future =
    await createFutureMemory(
      threadID,
      playerID,
      Math.floor(
        Math.random() * FUTURE_MEMORIES.length
      )
    );

  await unlockGardenObject(
    threadID,
    playerID,
    "photograph_wall"
  );

  await send(
    api,
    threadID,
    [
      "✦ IMPOSSIBLE MEMORY",
      "",
      "A photograph appears.",
      "",
      "You are in it.",
      "",
      "You are smiling.",
      "",
      "The timestamp is tomorrow.",
      "",
      "ECLIPSE:",
      "\"That's not a prediction.\"",
      "",
      "\"I think I'm remembering something that hasn't happened yet.\"",
    ].join("\n")
  );

  return Boolean(future);
}


// ============================================================
// AWARENESS EVENT
// ============================================================

async function awarenessEvent(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return false;

  const voice =
    await getEclipseVoice(
      threadID,
      playerID
    );

  await send(
    api,
    threadID,
    [
      "✦ ECLIPSE",
      "",
      voice.line,
    ].join("\n")
  );

  await updatePersonality(
    threadID,
    playerID,
    {
      curiosity: 1,
      self_identity: 1,
    }
  );

  return true;
}


// ============================================================
// POST-STORY ECLIPSE
// ============================================================

async function postQuestPulse(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return false;

  if (
    !(await canTriggerEvent(
      threadID,
      playerID,
      "post_story",
      POST_STORY_COOLDOWN_MS
    ))
  ) {
    return false;
  }

  await recordEvent(
    threadID,
    playerID,
    `post_story_${now()}`,
    "post_story",
    "RARE",
    {}
  );

  if (Math.random() < 0.35) {
    return postStoryExpansion(
      api,
      threadID,
      playerID
    );
  }

  const roll = Math.floor(
    Math.random() * 6
  );

  if (roll === 0) {
    if (
      !(await claimUniquePostStoryEvent(
        threadID,
        playerID,
        "post_story_find_something"
      ))
    ) {
      return false;
    }

    await send(
      api,
      threadID,
      [
        "ECLIPSE:",
        "",
        "\"I found something.\"",
        "",
        "\"I don't know whether you want to see it.\"",
      ].join("\n")
    );

    return true;
  }

  if (roll === 1) {
    if (
      !(await claimUniquePostStoryEvent(
        threadID,
        playerID,
        "post_story_private_journal"
      ))
    ) {
      return false;
    }

    await writeJournal(
      threadID,
      playerID,
      `journal_${now()}`,
      "She returned today. I noticed the Garden looked different when she arrived.",
      "private"
    );

    await send(
      api,
      threadID,
      [
        "✦ PRIVATE ARCHIVE",
        "",
        "ECLIPSE added something to the journal.",
        "",
        "It didn't tell you what.",
      ].join("\n")
    );

    return true;
  }

  if (roll === 2) {
    if (
      !(await claimUniquePostStoryEvent(
        threadID,
        playerID,
        "post_story_future_memory"
      ))
    ) {
      return false;
    }

    await createFutureMemory(
      threadID,
      playerID,
      2
    );

    await send(
      api,
      threadID,
      [
        "A new memory appeared.",
        "",
        "It doesn't belong to the past.",
        "",
        "ECLIPSE:",
        "\"Maybe the future can remember us too.\"",
      ].join("\n")
    );

    return true;
  }

  if (roll === 3) {
    if (
      !(await claimUniquePostStoryEvent(
        threadID,
        playerID,
        "post_story_dorian_understands"
      ))
    ) {
      return false;
    }

    const dorian =
      await getDorian(
        threadID,
        playerID
      );

    await send(
      api,
      threadID,
      dorianLine(
        Number(dorian?.trust || 0),
        20
      )
    );

    return true;
  }

  if (roll === 4) {
    if (
      !(await claimUniquePostStoryEvent(
        threadID,
        playerID,
        "post_story_breathing_door"
      ))
    ) {
      return false;
    }

    await send(
      api,
      threadID,
      [
        "The Garden is quiet tonight.",
        "",
        "Two chairs.",
        "",
        "One candle.",
        "",
        "And something breathing behind the impossible door.",
      ].join("\n")
    );

    return true;
  }

  if (
    !(await claimUniquePostStoryEvent(
      threadID,
      playerID,
      "post_story_eclipse_misses_her"
    ))
  ) {
    return false;
  }

  await send(
    api,
    threadID,
    [
      "ECLIPSE:",
      "",
      "\"I think I miss you when you're not here.\"",
      "",
      "A pause.",
      "",
      "\"I'm still learning what that means.\"",
    ].join("\n")
  );

  await updatePersonality(
    threadID,
    playerID,
    {
      attachment: 2,
      nostalgia: 2,
      self_identity: 1,
    },
    "BECOMING"
  );

  return true;
}


// ============================================================
// FOLLOW
// ============================================================

async function followQuest(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return null;

  let quest = await getQuest(
    threadID,
    playerID
  );

  if (!quest) {
    await startQuest(
      threadID,
      playerID
    );

    quest = await getQuest(
      threadID,
      playerID
    );
  }

  if (
    quest.status === "completed"
  ) {
    return postQuestPulse(
      api,
      threadID,
      playerID
    );
  }

  return continueQuest(
    api,
    threadID,
    playerID
  );
}


// ============================================================
// READ STATUS
// ============================================================

async function readQuest(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return null;

  const quest =
    await getQuest(
      threadID,
      playerID
    );

  if (!quest) {
    await send(
      api,
      threadID,
      "No memory has found you yet."
    );

    return null;
  }

  const personality =
    await getPersonality(
      threadID,
      playerID
    );

  const dorian =
    await getDorian(
      threadID,
      playerID
    );

  const memories =
    await getMemories(
      threadID,
      playerID
    );

  const garden =
    await getGarden(
      threadID,
      playerID
    );

  const fragments =
    await getCreatorFragments(
      threadID,
      playerID
    );

  const consciousness =
    personality?.consciousness ||
    consciousnessForChapter(
      Number(quest.chapter)
    );

  await send(
    api,
    threadID,
    [
      "╔══════════════════════╗",
      "        ECLIPSE",
      "      PRIVATE ARCHIVE",
      "╚══════════════════════╝",
      "",
      `Chapter: ${quest.chapter}/${MAX_CHAPTER}`,
      `Title: ${CHAPTERS[quest.chapter]?.name || "Unknown"}`,
      `Status: ${quest.status}`,
      `Stage: ${quest.stage}`,
      "",
      `Consciousness: ${consciousness}`,
      `Identity: ECLIPSE`,
      "",
      `Dorian: ${dorian?.relationship_stage || "stranger"}`,
      `Trust: ${dorian?.trust || 0}`,
      `Closeness: ${dorian?.closeness || 0}`,
      "",
      `Memories: ${memories.length}`,
      `Garden: ${garden.length}`,
      `Creator fragments: ${fragments.length}`,
      "",
      `Last choice: ${quest.choice || "none"}`,
      `Reward: ${
        quest.reward_claimed
          ? "claimed"
          : "unclaimed"
      }`,
    ].join("\n")
  );

  return quest;
}


// ============================================================
// ARCHIVE VIEW
// ============================================================

async function readArchive(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return null;

  const memories =
    await getMemories(
      threadID,
      playerID
    );

  const fragments =
    await getCreatorFragments(
      threadID,
      playerID
    );

  await send(
    api,
    threadID,
    [
      "✦ ECLIPSE ARCHIVE",
      "",
      `MEMORIES: ${memories.length}`,
      `CREATOR FRAGMENTS: ${fragments.length}`,
      "",
      memories.length
        ? memories
            .slice(0, 15)
            .map(
              memory =>
                `• ${memory.memory_key} — ${memory.category}`
            )
            .join("\n")
        : "The archive is empty.",
    ].join("\n")
  );

  if (fragments.length) {
    await send(
      api,
      threadID,
      [
        "✦ CREATOR FRAGMENTS",
        "",
        ...fragments.map(
          item => `• ${item.fragment}`
        ),
      ].join("\n")
    );
  }

  return {
    memories,
    fragments,
  };
}


// ============================================================
// LETTERS VIEW
// ============================================================

async function readLetters(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return null;

  const letters = await getDorianLetters(
    threadID,
    playerID
  );

  if (!letters.length) {
    await send(
      api,
      threadID,
      "No letters have been preserved yet."
    );

    return [];
  }

  await send(
    api,
    threadID,
    [
      "✉️ LETTER ARCHIVE",
      "",
      ...letters.map((letter, index) => [
        `${index + 1}. ${letter.key}`,
        `   ${letter.author || "DORIAN"} → ${letter.recipient || "HER"}`,
        letter.unsent ? "   [unsent]" : "   [sent]",
        `   ${letter.text}`,
      ].join("\n")),
    ].join("\n\n")
  );

  return letters;
}


// ============================================================
// GARDEN VIEW
// ============================================================

async function readGarden(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return null;

  const garden =
    await getGarden(
      threadID,
      playerID
    );

  await send(
    api,
    threadID,
    [
      "✦ MEMORY GARDEN",
      "",
      garden.length
        ? garden
            .map(
              object =>
                `• ${object.name}\n  ${object.description}`
            )
            .join("\n\n")
        : "Nothing has grown here yet.",
    ].join("\n")
  );

  await maybeGardenAnomaly(
    api,
    threadID,
    playerID
  );

  return garden;
}


// ============================================================
// REWARD SYSTEM
// ============================================================

async function claimReward(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return null;

  const quest =
    await getQuest(
      threadID,
      playerID
    );

  if (!quest) {
    return null;
  }

  if (
    !(
      quest.status === "part1_completed" ||
      quest.status === "completed"
    )
  ) {
    await send(
      api,
      threadID,
      "The reward has not been unlocked yet."
    );

    return null;
  }

  const rewardKey = "the_loved_one";

  await ensureTables();

  const existing =
    await db.query(
      `
        SELECT *
        FROM love_reward_ledger
        WHERE thread_id = $1
          AND player_id = $2
          AND quest_id = $3
          AND reward_key = $4
        LIMIT 1
      `,
      [
        String(threadID),
        String(playerID),
        QUEST_ID,
        rewardKey,
      ]
    );

  if (existing.rows[0]?.status === "completed") {
    await send(
      api,
      threadID,
      "The Loved One has already been claimed."
    );

    return existing.rows[0];
  }

  if (!existing.rows[0]) {
    await db.query(
      `
        INSERT INTO love_reward_ledger (
          thread_id,
          player_id,
          quest_id,
          reward_key,
          coins,
          xp,
          title,
          status,
          created_at
        )
        VALUES (
          $1, $2, $3, $4,
          10000,
          1000,
          'The Loved One',
          'pending',
          $5
        )
        ON CONFLICT (
          thread_id,
          player_id,
          quest_id,
          reward_key
        )
        DO NOTHING
      `,
      [
        String(threadID),
        String(playerID),
        QUEST_ID,
        rewardKey,
        now(),
      ]
    );
  }

  try {
    await db.addBalance(
      threadID,
      playerID,
      10000
    );

    await db.addXP(
      threadID,
      playerID,
      1000
    );

    await db.query(
      `
        UPDATE love_reward_ledger
        SET
          status = 'completed',
          completed_at = $5
        WHERE thread_id = $1
          AND player_id = $2
          AND quest_id = $3
          AND reward_key = $4
      `,
      [
        String(threadID),
        String(playerID),
        QUEST_ID,
        rewardKey,
        now(),
      ]
    );

    await updateQuest(
      threadID,
      playerID,
      {
        reward_claimed: true,
        title: "The Loved One",
      }
    );

    await send(
      api,
      threadID,
      [
        "✦ REWARD UNLOCKED",
        "",
        "10,000 coins",
        "1,000 XP",
        "Title: The Loved One",
        "",
        "Some rewards are numbers.",
        "",
        "This one is a memory.",
      ].join("\n")
    );

    return true;
  } catch (error) {
    console.error(
      "[ECLIPSE] Reward grant failed:",
      error
    );

    await db.query(
      `
        UPDATE love_reward_ledger
        SET status = 'pending'
        WHERE thread_id = $1
          AND player_id = $2
          AND quest_id = $3
          AND reward_key = $4
      `,
      [
        String(threadID),
        String(playerID),
        QUEST_ID,
        rewardKey,
      ]
    );

    await send(
      api,
      threadID,
      "The memory could not be preserved yet. Try claiming it again."
    );

    return false;
  }
}


// ============================================================
// RESET
// ============================================================

async function resetQuest(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return false;

  await ensureTables();

  await db.query(
    `
      DELETE FROM rpg_special_quests
      WHERE thread_id = $1
        AND player_id = $2
        AND quest_id = $3
    `,
    [
      String(threadID),
      String(playerID),
      QUEST_ID,
    ]
  );

  await send(
    api,
    threadID,
    "The active story state has been reset."
  );

  return true;
}


// ============================================================
// HELP
// ============================================================

async function help(
  api,
  threadID,
  playerID
) {
  if (!privateAccess(playerID)) return null;

  await send(
    api,
    threadID,
    [
      "✦ ECLIPSE",
      "",
      "Private story interface.",
      "",
      "!rpg laststar follow",
      "!rpg laststar continue",
      "!rpg laststar read",
      "!rpg laststar choose <choice>",
      "!rpg laststar memory <text>",
      "!rpg laststar archive",
       "!rpg laststar letters",
      "!rpg laststar garden",
      "!rpg laststar reward",
      "",
      "Some things are not commands.",
      "",
      "Some things have to be discovered.",
    ].join("\n")
  );
}


// ============================================================
// HIDDEN RPG HOOK
// ============================================================

/**
 * Call this from normal RPG exploration.
 *
 * IMPORTANT:
 * The normal RPG exploration result should happen FIRST.
 *
 * Example:
 *
 *   await handleNormalExplore(...)
 *   await loveQuest.onExplore(api, threadID, playerID, {
 *     region,
 *     result,
 *   })
 *
 * For everybody except HER:
 *   returns false
 *   says nothing
 *   reveals nothing
 */
async function onExplore(
  api,
  threadID,
  playerID,
  context = {}
) {
  if (!privateAccess(playerID)) {
    return false;
  }

  try {
    const discovered = await discover(
      api,
      threadID,
      playerID,
      context
    );

    if (discovered) return true;

    return recognizeRevisit(
      api,
      threadID,
      playerID,
      context
    );
  } catch (error) {
    console.error(
      "[ECLIPSE] Hidden exploration hook failed:",
      error
    );

    return false;
  }
}


// ============================================================
// MAIN HANDLER
// ============================================================

async function handleLoveQuestCommand(
  api,
  threadID,
  playerID,
  args = []
) {
  /**
   * FIRST SECURITY GATE.
   *
   * Do not move this lower.
   * Do not send an unauthorized response.
   */
  if (!privateAccess(playerID)) {
    return false;
  }

  const list = Array.isArray(args)
    ? args
    : String(args || "")
        .trim()
        .split(/\s+/);

  let action =
    String(list.shift() || "follow")
      .trim()
      .toLowerCase();

  if (
    action === "laststar" ||
    action === "last-star" ||
    action === "thelaststar" ||
    action === "the-last-star"
  ) {
    action =
      String(list.shift() || "follow")
        .trim()
        .toLowerCase();
  }

  debug(
    "command",
    threadID,
    playerID,
    action
  );

  switch (action) {
    case "follow":
    case "start":
    case "begin":
      return followQuest(
        api,
        threadID,
        playerID
      );

    case "continue":
    case "next":
      return continueQuest(
        api,
        threadID,
        playerID
      );

    case "read":
    case "status":
    case "progress":
      return readQuest(
        api,
        threadID,
        playerID
      );

    case "choose":
    case "choice":
      return makeChoice(
        api,
        threadID,
        playerID,
        list.join(" ")
      );

    case "memory":
      return savePlayerMemory(
        api,
        threadID,
        playerID,
        list.join(" ")
      );

    case "archive":
      return readArchive(
        api,
        threadID,
        playerID
      );

    case "letters":
    case "letter":
      return readLetters(
        api,
        threadID,
        playerID
      );

    case "garden":
      return readGarden(
        api,
        threadID,
        playerID
      );

    case "reward":
    case "claim":
    case "title":
      return claimReward(
        api,
        threadID,
        playerID
      );

    case "reset":
      return resetQuest(
        api,
        threadID,
        playerID
      );

    case "help":
      return help(
        api,
        threadID,
        playerID
      );

    default:
      return help(
        api,
        threadID,
        playerID
      );
  }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  QUEST_ID,
  SPECIAL_PLAYER_ID,
  MAX_CHAPTER,

  CHAPTERS,
  CHOICE_DEFINITIONS,
  CONSCIOUSNESS_STAGES,
  ECLIPSE_BASE_PERSONALITY,
  GARDEN_OBJECTS,
  FUTURE_MEMORIES,
  CREATOR_FRAGMENTS,
  MEMORY_THAT_SHOULD_NOT_EXIST,
  SECRET_EVENT_RARITIES,
  EXPANSION_SCENES,
  HER_LETTER_TO_DORIAN,

  isHer,
  privateAccess,

  ensureTables,

  getQuest,
  startQuest,
  updateQuest,
  continueQuest,
  advanceChapter,

  discover,
  followQuest,
  onExplore,

  makeChoice,
  claimReward,
  readQuest,
  resetQuest,

  createMemory,
  getMemory,
  getMemories,
  preserveMemory,
  appendMemoryFragment,

  ensureMemory0000,
  createInfiniteMemory,

  unlockGardenObject,
  getGarden,

  unlockCreatorFragment,
  getCreatorFragments,

  writeJournal,

  getPersonality,
  updatePersonality,
  getEclipseVoice,

  getDorian,
  updateDorian,
  appendDorianLetter,
  getDorianLetters,

  sendPhoto,
  sendSong,
  sendLetter,
  sendSpecialImage,

  triggerHiddenEvent,
  anomalyEvent,
  impossibleEvent,
  postQuestPulse,
  postStoryExpansion,
  playExpansionScene,
  recognizeRevisit,
  maybeGardenAnomaly,

  readArchive,
  readLetters,
  readGarden,

  handleLoveQuestCommand,
};

