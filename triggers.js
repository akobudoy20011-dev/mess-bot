// ============================================================
// TRIGGERS / BANAT SYSTEM
// ============================================================

const groups = [
  {
    name: "jaiden",
    triggers: ["jaiden"],
    index: 0,
    replies: [
      "jaiden na naman",
      "al-bai-no",
      "bai-gone",
      "bai-tamins",
      "one bai one",
      "why u coming at me? i rhyme the best, and you look like a hobo stupid like the rest",
      "man everybody finna wish theyve seen this, yo brain is small as yo dick",
      "ngl, idc since i have a home, n yo big ass booty stays on the street of rome",
      "jaiden, yung mukhang paa ba?",
      "ai nang ai tong utak kulugo na to",
      "mamaya ka na ulit mag kwento, jinajakol ako mama mo",
      "while some people debate na its not a mental health disorder, marami pa rin nag o-opposed sa idea na 'yan but jaiden is a living proof that being gay is a mental illness",
      "yung pinanganak ka, tapos may extra package kasi kamukha mo yung airbender",
      "ano kaya thought process neto at puro bintang sakin?",
      "ate mo kinakain ko puke, nilagyan ko peanut",
      "wrap it up kapatid, mukha kang kalabaw",
      "mama mo may tamod sa labi, galing sakin btw",
      "papa mo nakita ko sa alfamart taga bukas ng pinto",
      "kita ko mama mo nakikipag threesome sa aso",
      "mamaya mag rreport na to",
      "diko sinabi mag dabog ka sa harap ko gago",
      "pakunatan mental heath, tapos ako kinalaban mong pulubi ka",
      "la, jaiden ulit",
      "kinakantot ko ate mo sa backseat",
      "geh geh kwento ka lang habang jinajakol moko",
      "g na g mag talk a lot e wala naman akong pake",
      "tito mong daga mukhang nilaga",
      "ttkels lang kita",
      "si jaiden nasa kmjs, title e batang pinaglihi sa burat",
      "kelan kaya ma-phase out kagaya ni jaiden?",
      "si jaiden nakita ko nakatambay sa grinder e",
      "jaiden and his broke boys era",
      "pag broke jaiden, mamakla ka",
      "jaiden mukhang nahulugan langka e",
      "tangina mo, pake ko sa opinion mo",
      "kelan kaya tatangaling freedom of speech netong gago na to?",
      "onga e, mukha kang kumakain pwet",
      "todo sabat, akala mo naman may arit e anghit dala mo",
      "iyak si gago",
      "pake ko nga?",
      "turo mo sino nag tanong",
      "bilang ka muna",
      "moka ka libro",
      "moka ma fan",
      "moka ka mama mo",
      "moka ka lapis",
      "moka ka ttkels",
      "moka ka tiles",
      "moka ka jaiden, aahhh si jaiden ka nga pala hahahaah malas mo naman",
      "moka ka bahay",
      "moka ka semento",
      "moka ka aspalto",
      "moka ka braided na bulbul",
      "moka ka tanga",
      "moka ka gago",
      "moka ka loonie",
      "moka ka beetle juice",
      "si jaiden spotted namamakla",
      "yung tipong nag work out ka para lumaki katawan, eh kaso naging kamukha mo si jaiden",
    ],
  },

  {
    name: "bot",
    triggers: ["bot"],
    index: 0,
    replies: [
      "ikaw bot",
      "mama mo bot",
      "tapos ang laban NAG D.O SI TABA TAPOS PAULIT-ULIT NA LANG SA MGA INSULTO, DI CREATIVE PAG DATING SA TROLLING KAHIT TROLLER. LEHITOMONG BABOY NA SA FARM NA KAMUKHA NI WALLY BAYOLA AAAHA BAWI KA SAKIN DOGS KO, UPUAN MO TTKO BAGO KA ULIT SUMUBOK",
      "asan bot?",
      "hellmerry nga pala, crush moko kaya tingen panty",
      "bago bumoses dapat malaki dede ah",
      "turo mo yung bot gamit mataba mong daliri",
      "bot nang bot, aning ka?",
      "ikaw mukhang bot tanga",
      "wag aning sa ope",
      "onga e, bot lola mong paro paro",
      "bot nganii yung lolo mo",
      "ona bot na",
      "sige, on ko bot ko tapos deep talk kayo",
      "pumapalag ka pala sa bot e",
      "on mo lola mong bot",
      "kuha lang ako plato, tapos kain tayo kasama bot ko",
      "may bot pala?",
      "asan nga yung bot, kulit mo kalbo",
      "mamaya na, kausapin mo bot ko",
      "bilang ako mga 1 to 2 3 5 5 6 7 8 9 10 11 12 tapos mag on ako bot",
      "aaahh moka ka bot nga",
      "tangina, paulit-ulit",
      "paulit-ulit ka ba?",
      "bot ka nang bot, nagiging meme ka na",
      "bobo, wala akong pake sa sinasabi mo",
      "edi bot, kwento mo 'yan",
      "eh walang bawi?",
      "amoy basang aso tong kumag na 'to",
      "puta, baho mo, layo ka nga",
    ],
  },

  {
    name: "trash-talk",
    triggers: [
      "weak",
      "laro",
      "tanginamo",
      "lala",
      "patawa",
      "gago",
      "bobo",
      "tanga",
      "hahahaa",
      "pake ko",
      "sino yan",
    ],
    index: 0,
    replies: [
      "lakas mo magsalita, tulog ka naman nung Clash",
      "pabuhat ka pa rin hanggang ngayon bro",
      "umiyak ka na lang sa gilid",
      "lalers netong kumag na to",
      "bigyan niyo nga to piso, puta na pulubi tambay sa gc enoh?",
      "makipag-talk a lot ka sa lolo mong patay na",
      "maingay lang sa chat pero bano sa laro",
      "brush ka muna ng ngipin bago ka mag-chat",
      "puro ka daldal, minus ka naman sa points",
      "report post ka na lang mas bagay sa'yo",
      "tulog mo na lang yan, mukhang pagod ka na",
      "tahimik ka bigla nung natalo e",
      "crying emoji yarn?",
      "'di ka nga makatama ng skill shot e",
      "delete mo na lang account mo",
      "sino tinatakot mo, sarili mo?",
      "galit na galit gustong manakit",
      "balik ka na sa tutorial mode",
      "tulong ka na lang sa gawaing bahay",
      "practice ka muna kahit kanina lang",
      "ano, tuloy mo pa yang tapang mo?",
      "maingay pero bano",
      "cry me a river na lang beh",
    ],
  },

  {
    name: "casual-comebacks",
    triggers: [
      "ano",
      "sino ba",
      "ano na naman",
      "weh",
      "bakit",
      "sige",
    ],
    index: 0,
    replies: [
      "bat ka galit? kain ka muna lugaw",
      "sorry na, 'di ka na mabiro",
      "kumain ka na ba? parang kulang ka sa lasa",
      "inhale, exhale, baka pumutok ugat mo",
      "copy paste mo pa yan dali",
      "sigaw mo pa nang malakas, 'di pa naririnig",
      "o tapos? ano award mo niyan?",
      "e di ikaw na magaling, ikaw na President",
      "chat ka lang diyan, boring din e",
      "patingin nga ng resibo bago ka magsalita",
      "sige lang, libre naman mangarap",
      "ikain mo na lang yan ng ice cream",
      "galit yarn? pa-hug nga",
      "sige, kwento mo sa pagong",
      "busy ako, kausapin mo pusa ko",
      "haha sige support kita sa mental health mo",
      "sige lang, push mo pa yan",
      "oo na lang para matapos na",
      "breath in, breath out lang idol",
      "wala akong barya pambili ng pake mo",
    ],
  },

  // ==========================================================
  // NO ONE-LINERS GROUP
  // k / lol / haha / o ARE INTENTIONALLY NOT TRIGGERS
  // ==========================================================

  {
    name: "deflections",
    triggers: [
      "sino",
      "sino ka",
      "saan",
    ],
    index: 0,
    replies: [
      "tanong mo sa kapitbahay niyo",
      "search mo sa Google, baka alam nila",
      "sekretong malupit, walang nakakaalam",
      "tanong mo sa lolo mong paro-paro",
      "hanapin mo sa outer space",
      "ewan ko sa'yo, busy ako mag-meryenda",
      "wait lang, busy pa ko magpalamig ng tubig",
      "ask me if I care (spoilers: I don't)",
      "PM mo sa kapitan niyo",
      "bukas ko na sasagutin, gabi na",
      "i-consult mo muna sa barangay",
      "bulong mo sa hangin",
      "tingin ka sa likod mo",
      "tanong mo sa star",
      "basta ako, kumakain ng lumpia ngayon",
    ],
  },

  {
    name: "vincent",
    triggers: [
      "og vincent",
      "øg vincent",
      "vincent",
    ],
    index: 0,
    replies: [
      "vincent na naman",
      "vincent, tahimik ka muna",
      "ayan na si vincent",
      "'di valid opinion mo lalo't na ai abuser ka",
      "kunware maniniwala ako sa sinabi mo",
      "humulma ng katha under 2 mins hahahah aning moko baboy?",
      "sige, deep talk kami ng ai mo",
      "pake ko nga muna sa opinion mo?",
      "angas, 100 percent chatgpt effort",
      "copy paste mo ulit sa chatgpt",
      "tanggalin ko freedom of speech mo baboy",
      "aaaaaa pikon ka?",
      "talk to dola, gemini, grok, or chatgpt",
      "one bai one debate kayo ni ai mo",
      "pake ko, akala neto may leverage siya eh ai abuser naman",
      "vincent kailangan mo pa ba ng tutorial?",
      "may sinabi ba si vincent?",
    ],
  },

  {
    name: "cleydo",
    triggers: ["cleydo"],
    index: 0,
    replies: [
      "pst, cleydo na naman",
      "ayan na si cleydogs",
      "kalma muna",
      "e.d nga tayo, cleydo",
      "tatagos ka ba sa boss oma mo?",
      "hula mo sino ope sa ruby",
      "aning na sa ope",
      "mukha kang minudo",
      "deduce mo lahat ng available possibilities na autistic na may down syndrome si aselm, pero pag inapply mo yung empirical basis dito wala e, autistic na may down syndrome lalabas",
      "party acc to, wag ka maktol",
      "diko sinabi mag dabog ka",
      "copy paste ko na lang 'to",
      "may sinabi ba si cleydo?",
      "cleydo kailangan mo pa ba ng tutorial?",
      "tahimik ka muna, cleydo",
    ],
  },
];


// ============================================================
// PUBLIC ROAST
// ============================================================

const banatLinks = [
  "https://www.facebook.com/share/1PWwWcuVAm/",
  "https://www.facebook.com/share/1BQG8iRTE1/",
  "https://www.facebook.com/share/19NaYjAYMu/",
];

function getRandomBanatLink() {
  if (banatLinks.length === 0) {
    return null;
  }

  return banatLinks[
    Math.floor(Math.random() * banatLinks.length)
  ];
}

const publicRoastGroup = {
  name: "public",
  triggers: [],
  index: 0,
  replies: [
    "bro talks like his Wi-Fi has 1 bar 📶💀",
    "your brain loading screen got stuck 🧠⏳",
    "you bring NPC energy to every conversation 🎮💀",
    "bro really thought that was a comeback 😭",
    "your confidence is doing all the heavy lifting 💀",
    "bro's thoughts need subtitles 🧠😭",
    "you have the reaction time of a loading screen 🐌💀",
    "even autocorrect gave up on you 📱😭",
    "bro argues with facts and still loses 📉💀",
    "your comebacks have a 3–5 business day delay 📦😭",
    "bro's brain is running on demo mode 🧠💀",
    "you make silence sound intelligent 🤐😭",
    "bro got the personality of an expired CAPTCHA 🤖💀",
    "your logic just left the group chat 🚪💀",
    "bro speaks fluent nonsense 🗣️💀",
    "you really woke up and chose zero brain cells today 😭🧠",
    "bro's vocabulary got nerfed 📉💀",
    "your argument has more holes than Swiss cheese 🧀😭",
    "bro's common sense is on airplane mode ✈️💀",
    "you could lose an argument to a loading icon ⏳😭",
    "bro has negative aura points 📉💀",
    "your thoughts are buffering in 144p 🧠📺",
    "bro's comeback expired before he sent it ⏰💀",
    "you bring tutorial-level energy to boss fights 🎮😭",
    "bro's brain said 'I'll sit this one out' 🧠🪑",
    "your logic needs a software update 🔄💀",
    "bro has the strategic thinking of a potato 🥔😭",
    "even your excuses need an excuse 💀",
    "bro's confidence is sponsored by delusion 😭💀",
    "your brain has too many tabs open and none are useful 🧠🖥️",
    "bro's insults hit like a wet tissue 🧻💀",
    "you have the charisma of a mandatory update 📱😭",
    "bro's processing power is fighting for its life 🧠🔥",
    "your comeback came with dial-up internet 📞💀",
    "bro's thoughts are still in beta testing 🧪😭",
    "you make confusion look like a career 💼💀",
    "bro's brain needs customer support 📞🧠",
    "your logic took a wrong turn and never came back 🚗💀",
    "bro has the energy of an unplugged controller 🎮😭",
    "you really said that with confidence too 💀😭",
    "bro's brain is running on 2% battery 🔋💀",
    "your argument got rejected by basic arithmetic ➗😭",
    "bro's personality is still downloading ⬇️💀",
    "you could make a calculator question its purpose 🧮😭",
    "bro's common sense is permanently AFK 🎮💀",
    "your comeback has less impact than a notification sound 🔔😭",
    "bro's brain took a lunch break mid-sentence 🧠🍔💀",
    "you bring side-character energy to your own story 📖💀",
    "bro's logic is held together by duct tape 🩹😭",
    "even your shadow is distancing itself 🌑💀",
  ],
};

groups.push(publicRoastGroup);


// ============================================================
// JAIDEN CLONES
// ============================================================

const jaidenGroupForClones = groups.find(
  (group) => group.name === "jaiden"
);

if (jaidenGroupForClones) {
  const clones = [
    ["jeo", ["jeø", "jeo"], "Jeø"],
    ["aeix", ["aeix"], "Aeix"],
    ["kikay", ["kikay"], "Kikay"],
    ["sylora", ["sylora"], "Sylora"],
    ["rishan", ["rishan"], "Rishan"],
    ["marcellus", ["marcellus"], "Marcellus"],
    ["theone", ["theone"], "Theone"],
  ];

  for (const [name, triggers, replacement] of clones) {
    groups.push({
      name,
      triggers,
      index: 0,
      replies: jaidenGroupForClones.replies.map((reply) =>
        String(reply).replace(
          /\bjaiden\b/gi,
          replacement
        )
      ),
    });
  }
}


// ============================================================
// SANTA BISAYA
// ============================================================

const santaBisayaGroup = {
  name: "santa-bisaya",

  triggers: [
    "santa bisaya",
    "santa-bisaya",
  ],

  index: 0,

  replies: groups
    .flatMap((group) =>
      Array.isArray(group.replies)
        ? group.replies
        : []
    )
    .map((reply) =>
      String(reply).replace(
        /\bjaiden\b/gi,
        "Santa Bisaya"
      )
    ),
};

groups.push(santaBisayaGroup);


// ============================================================
// TRIGGER MATCHING
// ============================================================

function matchesTrigger(text, trigger) {
  const normalizedText =
    normalizeText(text);

  const normalizedTrigger =
    normalizeText(trigger);

  if (
    !normalizedText ||
    !normalizedTrigger
  ) {
    return false;
  }

  const escaped =
    escapeRegExp(normalizedTrigger);

  // Proper Unicode boundaries.
  // Prevents:
  // bot -> matching "bottom"
  // sino -> matching "sinong"
  // laro -> matching "laro123"
  //
  // Still matches:
  // "bot!"
  // "hey bot"
  // "sino?"
  // "laro tayo"

  const regex = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
    "iu"
  );

  return regex.test(normalizedText);
}


// ============================================================
// TRIGGER / ID MATCHING
// ============================================================

function getTriggerReply(
  rawText,
  senderId
) {
  if (!rawText) {
    return null;
  }

  const text =
    normalizeText(rawText);

  const normalizedSenderId =
    normalizeId(senderId);


  // ----------------------------------------------------------
  // EXPLICIT WORD / PHRASE TRIGGERS
  // ----------------------------------------------------------

  for (const group of groups) {
    if (
      !Array.isArray(group.triggers) ||
      group.triggers.length === 0
    ) {
      continue;
    }

    if (
      !Array.isArray(group.replies) ||
      group.replies.length === 0
    ) {
      continue;
    }

    const hit =
      group.triggers.some(
        (trigger) =>
          matchesTrigger(
            text,
            trigger
          )
      );

    if (hit) {
      return getNextReply(group);
    }
  }


  // ----------------------------------------------------------
  // MESSENGER ID TARGETS
  // ----------------------------------------------------------

  const roastTargets = {};

  const envMap = {
    jaiden: [
      "JAIDEN_ID",
      "JAYDEN_ID",
    ],

    sylora: ["SYLORA_ID"],
    marcellus: ["MARCELLUS_ID"],
    theone: ["THEONE_ID"],
    vincent: ["VINCENT_ID"],
    aselm: ["ASELM_ID"],
    jeo: ["JEO_ID"],
    aeix: ["AEIX_ID"],
    kikay: ["KIKAY_ID"],
    mizzy: ["MIZZY_ID"],
    "santa-bisaya": [
      "SANTA_BISAYA_ID",
    ],
    xeth: ["XETH_ID"],
  };

  for (
    const [groupName, envNames]
    of Object.entries(envMap)
  ) {
    for (const envName of envNames) {
      const configuredId =
        normalizeId(
          process.env[envName]
        );

      if (configuredId) {
        roastTargets[groupName] =
          configuredId;

        break;
      }
    }
  }


  // ----------------------------------------------------------
  // ADDITIONAL TARGETS
  //
  // ROAST_TARGET_IDS=
  // jaiden:123,vincent:456
  // ----------------------------------------------------------

  const additionalTargets =
    String(
      process.env.ROAST_TARGET_IDS ||
      ""
    );

  for (
    const entry
    of additionalTargets.split(",")
  ) {
    const separator =
      entry.indexOf(":");

    if (separator === -1) {
      continue;
    }

    const groupName =
      entry
        .slice(0, separator)
        .trim()
        .toLowerCase();

    const targetId =
      normalizeId(
        entry.slice(
          separator + 1
        )
      );

    if (
      groupName &&
      targetId
    ) {
      roastTargets[groupName] =
        targetId;
    }
  }


  // ----------------------------------------------------------
  // CHECK SENDER ID
  // ----------------------------------------------------------

  if (normalizedSenderId) {
    for (
      const [groupName, targetId]
      of Object.entries(
        roastTargets
      )
    ) {
      if (
        targetId !==
        normalizedSenderId
      ) {
        continue;
      }

      const targetGroup =
        groups.find(
          (group) =>
            group.name ===
            groupName
        );

      if (targetGroup) {
        return getNextReply(
          targetGroup
        );
      }
    }
  }

  return null;
}


// ============================================================
// PUBLIC ROAST
// ============================================================

function getNextPublicReply() {
  const group =
    groups.find(
      (g) => g.name === "public"
    );

  return getNextReply(group);
}

// ============================================================
 // BANAT MEDIA / LINK HELPERS
 // ============================================================

 function shouldAttachBanatPicture() {
   return Math.random() < 0.30;
 }

 function shouldAttachBanatLink() {
   return Math.random() < 0.12;
 }

 function getBanatMediaDecision() {
   const attachPicture = shouldAttachBanatPicture();
   const attachLink = shouldAttachBanatLink();

   return {
     attachPicture,
     attachLink,
     link: attachLink ? getRandomBanatLink() : null,
   };
 }


// ============================================================
// RANDOM GENERIC ROAST
// ============================================================

function getRandomRoastReply() {
  const genericGroups =
    groups.filter(
      (group) =>
        group.name === "trash-talk"
    );

  const replies =
    genericGroups.flatMap(
      (group) =>
        Array.isArray(group.replies)
          ? group.replies
          : []
    );

  if (replies.length === 0) {
    return null;
  }

  return replies[
    Math.floor(
      Math.random() *
      replies.length
    )
  ];
}


// ============================================================
// SEQUENTIAL REPLY
// ============================================================

function getNextReply(group) {
  if (
    !group ||
    !Array.isArray(group.replies) ||
    group.replies.length === 0
  ) {
    return null;
  }

  if (
    !Number.isInteger(group.index)
  ) {
    group.index = 0;
  }

  const reply =
    group.replies[
      group.index %
      group.replies.length
    ];

  group.index =
    (group.index + 1) %
    group.replies.length;

  return reply;
}


// ============================================================
// NORMALIZATION
// ============================================================

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeId(value) {
  return String(value || "")
    .trim()
    .replace(
      /^["']|["']$/g,
      ""
    );
}


// ============================================================
// ESCAPE REGEX
// ============================================================

function escapeRegExp(str) {
  return String(str).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getTriggerReply,
  getRandomRoastReply,
  getNextPublicReply,
  getRandomBanatLink,
  getBanatMediaDecision,

  normalizeText,
  normalizeId,
  matchesTrigger,

  groups,
  publicRoastGroup,
};
