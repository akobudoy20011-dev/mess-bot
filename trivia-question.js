/**
 * trivia-questions.js
 * ===================
 * 250 trivia questions for games.js
 *
 * answer:
 * 0 = A
 * 1 = B
 * 2 = C
 * 3 = D
 */

const TRIVIA_QUESTIONS = [

  // ============================================================
  // SCIENCE — 25 QUESTIONS
  // ============================================================

  {
    q: "Which element has the chemical symbol 'O'?",
    options: ["Gold", "Oxygen", "Osmium", "Silver"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is the largest organ in the human body?",
    options: ["Heart", "Liver", "Skin", "Lungs"],
    answer: 2,
    reward: 250
  },
  {
    q: "What force keeps planets in orbit around the Sun?",
    options: ["Magnetism", "Gravity", "Friction", "Electricity"],
    answer: 1,
    reward: 300
  },
  {
    q: "What is H2O commonly known as?",
    options: ["Hydrogen", "Oxygen", "Salt", "Water"],
    answer: 3,
    reward: 200
  },
  {
    q: "How many bones are in the typical adult human body?",
    options: ["186", "206", "226", "256"],
    answer: 1,
    reward: 300
  },
  {
    q: "What gas do plants absorb during photosynthesis?",
    options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"],
    answer: 2,
    reward: 250
  },
  {
    q: "What is the center of an atom called?",
    options: ["Electron", "Nucleus", "Proton", "Molecule"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is the hardest naturally occurring mineral?",
    options: ["Quartz", "Diamond", "Iron", "Granite"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which blood cells help fight infections?",
    options: ["Red blood cells", "White blood cells", "Platelets", "Plasma cells"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is the boiling point of water at sea level in Celsius?",
    options: ["50°C", "75°C", "100°C", "150°C"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which planet has the strongest known winds in our solar system?",
    options: ["Earth", "Mars", "Neptune", "Mercury"],
    answer: 2,
    reward: 400
  },
  {
    q: "What is the chemical symbol for sodium?",
    options: ["So", "Na", "Sd", "S"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which part of the cell contains most of its genetic material?",
    options: ["Nucleus", "Cell wall", "Ribosome", "Cytoplasm"],
    answer: 0,
    reward: 250
  },
  {
    q: "What type of animal is a frog?",
    options: ["Reptile", "Mammal", "Amphibian", "Bird"],
    answer: 2,
    reward: 200
  },
  {
    q: "What is the approximate speed of light in a vacuum?",
    options: ["300 km/s", "3,000 km/s", "30,000 km/s", "300,000 km/s"],
    answer: 3,
    reward: 400
  },
  {
    q: "Which vitamin is mainly produced by the skin through sunlight exposure?",
    options: ["Vitamin A", "Vitamin B12", "Vitamin C", "Vitamin D"],
    answer: 3,
    reward: 300
  },
  {
    q: "What is the smallest unit of an element that retains its chemical properties?",
    options: ["Atom", "Cell", "Tissue", "Organ"],
    answer: 0,
    reward: 250
  },
  {
    q: "Which organ pumps blood throughout the human body?",
    options: ["Brain", "Heart", "Kidney", "Liver"],
    answer: 1,
    reward: 200
  },
  {
    q: "What is the study of earthquakes called?",
    options: ["Geology", "Seismology", "Meteorology", "Biology"],
    answer: 1,
    reward: 350
  },
  {
    q: "Which gas makes up the largest percentage of Earth's atmosphere?",
    options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"],
    answer: 2,
    reward: 250
  },
  {
    q: "What is the nearest star to Earth?",
    options: ["Sirius", "Proxima Centauri", "The Sun", "Betelgeuse"],
    answer: 2,
    reward: 200
  },
  {
    q: "What is the process by which liquid changes into gas?",
    options: ["Condensation", "Freezing", "Evaporation", "Melting"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which particle has a negative electrical charge?",
    options: ["Proton", "Neutron", "Electron", "Nucleus"],
    answer: 2,
    reward: 250
  },
  {
    q: "What is the chemical symbol for iron?",
    options: ["Ir", "Fe", "In", "I"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which human organ is primarily responsible for filtering blood and producing urine?",
    options: ["Kidneys", "Lungs", "Heart", "Stomach"],
    answer: 0,
    reward: 300
  },


  // ============================================================
  // GEOGRAPHY — 25 QUESTIONS
  // ============================================================

  {
    q: "What is the largest continent?",
    options: ["Africa", "Europe", "Asia", "North America"],
    answer: 2,
    reward: 250
  },
  {
    q: "What is the capital of Japan?",
    options: ["Kyoto", "Osaka", "Tokyo", "Hiroshima"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which country is shaped like a boot?",
    options: ["Spain", "Italy", "Greece", "Portugal"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is the largest ocean on Earth?",
    options: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean", "Pacific Ocean"],
    answer: 3,
    reward: 250
  },
  {
    q: "Which country has the city of Cairo as its capital?",
    options: ["Egypt", "Morocco", "Jordan", "Turkey"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is the capital of France?",
    options: ["Madrid", "Paris", "Rome", "Berlin"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which desert is the largest hot desert in the world?",
    options: ["Gobi", "Sahara", "Kalahari", "Atacama"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which country is home to Mount Fuji?",
    options: ["China", "South Korea", "Japan", "Thailand"],
    answer: 2,
    reward: 250
  },
  {
    q: "What is the capital of the Philippines?",
    options: ["Cebu City", "Davao City", "Quezon City", "Manila"],
    answer: 3,
    reward: 200
  },
  {
    q: "Which river is commonly regarded as the longest river in the world?",
    options: ["Amazon", "Nile", "Yangtze", "Mississippi"],
    answer: 1,
    reward: 350
  },
  {
    q: "Which country has the most islands?",
    options: ["Indonesia", "Sweden", "Japan", "Canada"],
    answer: 1,
    reward: 400
  },
  {
    q: "What is the capital of Australia?",
    options: ["Sydney", "Melbourne", "Canberra", "Perth"],
    answer: 2,
    reward: 300
  },
  {
    q: "Which country is famous for the Great Pyramids of Giza?",
    options: ["Egypt", "Mexico", "Peru", "Iraq"],
    answer: 0,
    reward: 200
  },
  {
    q: "Which mountain is the tallest above sea level?",
    options: ["K2", "Mount Everest", "Kilimanjaro", "Denali"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is the capital of Canada?",
    options: ["Toronto", "Vancouver", "Montreal", "Ottawa"],
    answer: 3,
    reward: 300
  },
  {
    q: "Which country is home to Machu Picchu?",
    options: ["Chile", "Peru", "Bolivia", "Brazil"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which continent is the Sahara Desert located in?",
    options: ["Asia", "Africa", "Australia", "South America"],
    answer: 1,
    reward: 200
  },
  {
    q: "What is the capital of South Korea?",
    options: ["Busan", "Seoul", "Incheon", "Daegu"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which country is known for the ancient city of Petra?",
    options: ["Jordan", "Lebanon", "Israel", "Syria"],
    answer: 0,
    reward: 350
  },
  {
    q: "Which ocean lies between Africa and Australia?",
    options: ["Atlantic Ocean", "Pacific Ocean", "Indian Ocean", "Arctic Ocean"],
    answer: 2,
    reward: 300
  },
  {
    q: "What is the capital of Brazil?",
    options: ["Rio de Janeiro", "São Paulo", "Brasília", "Salvador"],
    answer: 2,
    reward: 300
  },
  {
    q: "Which country is home to the city of Barcelona?",
    options: ["Portugal", "Spain", "France", "Italy"],
    answer: 1,
    reward: 200
  },
  {
    q: "What is the smallest continent by land area?",
    options: ["Europe", "Australia", "Antarctica", "South America"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which country has the city of Istanbul?",
    options: ["Greece", "Turkey", "Bulgaria", "Georgia"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which country is famous for the fjords of Scandinavia?",
    options: ["Norway", "Germany", "Poland", "Austria"],
    answer: 0,
    reward: 300
  },


  // ============================================================
  // HISTORY — 25 QUESTIONS
  // ============================================================

  {
    q: "Who was the first president of the United States?",
    options: ["Abraham Lincoln", "George Washington", "Thomas Jefferson", "John Adams"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which ancient civilization built the Colosseum?",
    options: ["Greeks", "Romans", "Egyptians", "Persians"],
    answer: 1,
    reward: 250
  },
  {
    q: "Who was known as the Maid of Orléans?",
    options: ["Cleopatra", "Joan of Arc", "Marie Curie", "Catherine the Great"],
    answer: 1,
    reward: 350
  },
  {
    q: "Which ship famously sank in 1912?",
    options: ["Lusitania", "Titanic", "Bismarck", "Endurance"],
    answer: 1,
    reward: 200
  },
  {
    q: "Who was the first emperor of Rome?",
    options: ["Julius Caesar", "Augustus", "Nero", "Constantine"],
    answer: 1,
    reward: 350
  },
  {
    q: "Which civilization developed democracy in ancient Athens?",
    options: ["Roman", "Greek", "Egyptian", "Mayan"],
    answer: 1,
    reward: 300
  },
  {
    q: "Who wrote the Declaration of Independence's famous draft?",
    options: ["George Washington", "Thomas Jefferson", "Benjamin Franklin", "James Madison"],
    answer: 1,
    reward: 350
  },
  {
    q: "The Great Wall is located in which country?",
    options: ["Japan", "China", "Mongolia", "India"],
    answer: 1,
    reward: 200
  },
  {
    q: "Who was the Egyptian queen associated with Julius Caesar and Mark Antony?",
    options: ["Nefertiti", "Cleopatra VII", "Hatshepsut", "Merneith"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which empire was ruled by Genghis Khan?",
    options: ["Roman Empire", "Mongol Empire", "Ottoman Empire", "Byzantine Empire"],
    answer: 1,
    reward: 300
  },
  {
    q: "In which year did World War II end?",
    options: ["1943", "1944", "1945", "1946"],
    answer: 2,
    reward: 300
  },
  {
    q: "Who was the first person to walk on the Moon?",
    options: ["Buzz Aldrin", "Neil Armstrong", "Yuri Gagarin", "John Glenn"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which ancient civilization used hieroglyphics?",
    options: ["Egyptians", "Romans", "Vikings", "Aztecs"],
    answer: 0,
    reward: 250
  },
  {
    q: "Who was the famous military leader from Carthage who crossed the Alps?",
    options: ["Hannibal", "Scipio", "Alexander", "Leonidas"],
    answer: 0,
    reward: 400
  },
  {
    q: "Which revolution began in France in 1789?",
    options: ["Industrial Revolution", "French Revolution", "Russian Revolution", "Glorious Revolution"],
    answer: 1,
    reward: 250
  },
  {
    q: "Who was the first emperor of unified China?",
    options: ["Qin Shi Huang", "Sun Tzu", "Confucius", "Kublai Khan"],
    answer: 0,
    reward: 400
  },
  {
    q: "Which famous document was signed in 1215?",
    options: ["Magna Carta", "Treaty of Versailles", "Code of Hammurabi", "Edict of Milan"],
    answer: 0,
    reward: 400
  },
  {
    q: "Who was the leader of the Soviet Union during much of World War II?",
    options: ["Vladimir Lenin", "Joseph Stalin", "Leon Trotsky", "Mikhail Gorbachev"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which city was buried by Mount Vesuvius in AD 79?",
    options: ["Pompeii", "Athens", "Sparta", "Carthage"],
    answer: 0,
    reward: 300
  },
  {
    q: "Who was the famous civil rights leader who delivered the 'I Have a Dream' speech?",
    options: ["Malcolm X", "Martin Luther King Jr.", "Rosa Parks", "Frederick Douglass"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which empire used the Janissaries as elite soldiers?",
    options: ["Ottoman Empire", "Mongol Empire", "Roman Empire", "Aztec Empire"],
    answer: 0,
    reward: 400
  },
  {
    q: "Who was the first woman to win a Nobel Prize?",
    options: ["Ada Lovelace", "Marie Curie", "Florence Nightingale", "Jane Goodall"],
    answer: 1,
    reward: 350
  },
  {
    q: "Which civilization built the city of Tenochtitlan?",
    options: ["Maya", "Aztec", "Inca", "Olmec"],
    answer: 1,
    reward: 350
  },
  {
    q: "Who was known as the Sun King?",
    options: ["Louis XIV", "Henry VIII", "Napoleon", "Charlemagne"],
    answer: 0,
    reward: 350
  },
  {
    q: "Which war was fought between the North and South in the United States?",
    options: ["Revolutionary War", "Civil War", "War of 1812", "Spanish-American War"],
    answer: 1,
    reward: 250
  },


  // ============================================================
  // GAMING — 25 QUESTIONS
  // ============================================================

  {
    q: "What does NPC stand for in gaming?",
    options: ["Non-Playable Character", "New Player Character", "Next Player Command", "Non-Point Character"],
    answer: 0,
    reward: 150
  },
  {
    q: "Which company created Minecraft?",
    options: ["Valve", "Mojang", "Nintendo", "Epic Games"],
    answer: 1,
    reward: 200
  },
  {
    q: "What is Mario's brother's name?",
    options: ["Wario", "Luigi", "Waluigi", "Toad"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which game features the character Master Chief?",
    options: ["Halo", "Destiny", "Gears of War", "Doom"],
    answer: 0,
    reward: 250
  },
  {
    q: "What is the main currency in Fortnite?",
    options: ["Robux", "V-Bucks", "Minecoins", "Credits"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which company makes the PlayStation?",
    options: ["Microsoft", "Sony", "Nintendo", "Sega"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which company makes the Xbox?",
    options: ["Sony", "Microsoft", "Nintendo", "Valve"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which game series features the character Link?",
    options: ["Final Fantasy", "The Legend of Zelda", "Pokémon", "Metroid"],
    answer: 1,
    reward: 250
  },
  {
    q: "What type of game is League of Legends?",
    options: ["MOBA", "RPG", "Racing", "Simulation"],
    answer: 0,
    reward: 300
  },
  {
    q: "Which game features Creepers?",
    options: ["Terraria", "Minecraft", "Roblox", "Rust"],
    answer: 1,
    reward: 200
  },
  {
    q: "What color is Sonic the Hedgehog?",
    options: ["Red", "Green", "Blue", "Purple"],
    answer: 2,
    reward: 150
  },
  {
    q: "Which Pokémon is number 025 in the National Pokédex?",
    options: ["Charmander", "Pikachu", "Bulbasaur", "Squirtle"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is the name of the princess commonly rescued by Mario?",
    options: ["Zelda", "Peach", "Daisy", "Rosalina"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which game features the battle royale map Erangel?",
    options: ["PUBG", "Apex Legends", "Fortnite", "Valorant"],
    answer: 0,
    reward: 300
  },
  {
    q: "What is the main character's name in the God of War series?",
    options: ["Kratos", "Atreus", "Drake", "Dante"],
    answer: 0,
    reward: 200
  },
  {
    q: "Which game series features the character Lara Croft?",
    options: ["Uncharted", "Tomb Raider", "Assassin's Creed", "Resident Evil"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which game is known for the phrase 'Victory Royale'?",
    options: ["Apex Legends", "Fortnite", "PUBG", "Overwatch"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is the name of the block-building game developed by Mojang?",
    options: ["Roblox", "Minecraft", "Terraria", "Cube World"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which game features agents such as Jett and Phoenix?",
    options: ["Overwatch", "Valorant", "CS2", "Rainbow Six Siege"],
    answer: 1,
    reward: 350
  },
  {
    q: "Which Nintendo console followed the Nintendo Entertainment System?",
    options: ["Nintendo 64", "Super Nintendo Entertainment System", "GameCube", "Wii"],
    answer: 1,
    reward: 350
  },
  {
    q: "Which game series features the character Geralt of Rivia?",
    options: ["Skyrim", "The Witcher", "Dragon Age", "Dark Souls"],
    answer: 1,
    reward: 300
  },
  {
    q: "What is the name of the company behind Steam?",
    options: ["Valve", "EA", "Ubisoft", "Activision"],
    answer: 0,
    reward: 300
  },
  {
    q: "Which game features the item called the Master Sword?",
    options: ["Final Fantasy", "The Legend of Zelda", "Kingdom Hearts", "Fire Emblem"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which survival game features dinosaurs that can be tamed?",
    options: ["ARK: Survival Evolved", "Rust", "DayZ", "The Forest"],
    answer: 0,
    reward: 300
  },
  {
    q: "What genre is typically abbreviated as RPG?",
    options: ["Real Player Game", "Role-Playing Game", "Rapid Play Game", "Random Player Game"],
    answer: 1,
    reward: 200
  },


  // ============================================================
  // MOVIES & TV — 25 QUESTIONS
  // ============================================================

  {
    q: "Which movie features the character Jack Dawson?",
    options: ["Avatar", "Titanic", "The Matrix", "Gladiator"],
    answer: 1,
    reward: 250
  },
  {
    q: "Who played the character Iron Man in the Marvel Cinematic Universe?",
    options: ["Chris Evans", "Robert Downey Jr.", "Chris Hemsworth", "Mark Ruffalo"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which movie features the fictional world of Pandora?",
    options: ["Avatar", "Dune", "Interstellar", "The Matrix"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is the name of Batman's city?",
    options: ["Metropolis", "Gotham City", "Star City", "Central City"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which film series features Hogwarts?",
    options: ["The Lord of the Rings", "Harry Potter", "The Chronicles of Narnia", "Twilight"],
    answer: 1,
    reward: 200
  },
  {
    q: "Who is the main villain of the original Star Wars trilogy?",
    options: ["Kylo Ren", "Darth Vader", "Thanos", "Voldemort"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which movie features the character Forrest Gump?",
    options: ["Forrest Gump", "Cast Away", "The Green Mile", "Saving Private Ryan"],
    answer: 0,
    reward: 150
  },
  {
    q: "What is the name of Thor's hammer?",
    options: ["Stormbreaker", "Mjolnir", "Excalibur", "Gungnir"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which movie features dinosaurs brought back through genetic engineering?",
    options: ["Jurassic Park", "King Kong", "Godzilla", "The Lost World"],
    answer: 0,
    reward: 200
  },
  {
    q: "Which fictional character says 'I am Groot'?",
    options: ["Rocket", "Groot", "Drax", "Vision"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which movie features the character Neo?",
    options: ["Inception", "The Matrix", "Blade Runner", "Tenet"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is the name of the lion protagonist in The Lion King?",
    options: ["Scar", "Simba", "Mufasa", "Timon"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which series features the fictional land of Westeros?",
    options: ["Vikings", "Game of Thrones", "The Witcher", "Spartacus"],
    answer: 1,
    reward: 250
  },
  {
    q: "Who directed the movie Jurassic Park?",
    options: ["James Cameron", "Steven Spielberg", "Christopher Nolan", "Peter Jackson"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which film features the character Jack Sparrow?",
    options: ["Pirates of the Caribbean", "Master and Commander", "Treasure Island", "The Mummy"],
    answer: 0,
    reward: 200
  },
  {
    q: "Which superhero is also known as the Man of Steel?",
    options: ["Batman", "Superman", "Iron Man", "Captain America"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which movie features a character named Buzz Lightyear?",
    options: ["Toy Story", "Cars", "Up", "Wall-E"],
    answer: 0,
    reward: 150
  },
  {
    q: "What is the name of the school attended by Wednesday Addams in Wednesday?",
    options: ["Nevermore Academy", "Hogwarts", "Ravenwood Academy", "Mystic Falls High"],
    answer: 0,
    reward: 300
  },
  {
    q: "Which film series features the character Ethan Hunt?",
    options: ["James Bond", "Mission: Impossible", "Bourne", "Kingsman"],
    answer: 1,
    reward: 250
  },
  {
    q: "Who is the main antagonist of The Lion King?",
    options: ["Mufasa", "Scar", "Timon", "Zazu"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which movie is about a dream within a dream?",
    options: ["Inception", "Interstellar", "Gravity", "Tenet"],
    answer: 0,
    reward: 300
  },
  {
    q: "Which fictional detective lives at 221B Baker Street?",
    options: ["Hercule Poirot", "Sherlock Holmes", "Columbo", "Batman"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which animated film features Elsa and Anna?",
    options: ["Tangled", "Frozen", "Moana", "Brave"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which movie series features the character John Wick?",
    options: ["John Wick", "Taken", "Die Hard", "Nobody"],
    answer: 0,
    reward: 200
  },
  {
    q: "Which superhero team includes Captain America, Thor, and Iron Man?",
    options: ["Justice League", "The Avengers", "X-Men", "Guardians"],
    answer: 1,
    reward: 200
  },


  // ============================================================
  // MUSIC — 25 QUESTIONS
  // ============================================================

  {
    q: "How many strings does a standard guitar usually have?",
    options: ["4", "5", "6", "7"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which instrument has black and white keys?",
    options: ["Violin", "Piano", "Trumpet", "Flute"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which musical symbol indicates silence?",
    options: ["Note", "Rest", "Clef", "Sharp"],
    answer: 1,
    reward: 250
  },
  {
    q: "How many notes are in a standard major scale?",
    options: ["5", "6", "7", "8"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which instrument is commonly associated with a bow and four strings?",
    options: ["Violin", "Trumpet", "Piano", "Drum"],
    answer: 0,
    reward: 200
  },
  {
    q: "What does BPM stand for in music?",
    options: ["Beats Per Minute", "Bass Per Measure", "Bars Per Melody", "Beats Per Measure"],
    answer: 0,
    reward: 250
  },
  {
    q: "Which instrument belongs to the brass family?",
    options: ["Trumpet", "Violin", "Clarinet", "Piano"],
    answer: 0,
    reward: 250
  },
  {
    q: "What is the term for a song performed by one person?",
    options: ["Duet", "Solo", "Trio", "Quartet"],
    answer: 1,
    reward: 150
  },
  {
    q: "How many people perform a duet?",
    options: ["1", "2", "3", "4"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which genre is strongly associated with improvisation and swing?",
    options: ["Jazz", "Opera", "Reggae", "Metal"],
    answer: 0,
    reward: 250
  },
  {
    q: "Which instrument is commonly played with sticks?",
    options: ["Drums", "Violin", "Flute", "Harp"],
    answer: 0,
    reward: 150
  },
  {
    q: "What is a group of singers called?",
    options: ["Choir", "Orchestra", "Quartet", "Band"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is the lowest common male singing voice?",
    options: ["Tenor", "Baritone", "Bass", "Alto"],
    answer: 2,
    reward: 300
  },
  {
    q: "Which instrument has pedals and many strings inside a wooden frame?",
    options: ["Harp", "Piano", "Guitar", "Cello"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is the musical term for getting gradually louder?",
    options: ["Decrescendo", "Crescendo", "Staccato", "Legato"],
    answer: 1,
    reward: 300
  },
  {
    q: "What is the musical term for getting gradually softer?",
    options: ["Crescendo", "Decrescendo", "Fortissimo", "Allegro"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which genre originated in Jamaica and is associated with artists such as Bob Marley?",
    options: ["Reggae", "Blues", "Country", "Disco"],
    answer: 0,
    reward: 250
  },
  {
    q: "Which instrument is traditionally associated with Scottish bagpipe music?",
    options: ["Bagpipes", "Mandolin", "Oboe", "Sitar"],
    answer: 0,
    reward: 150
  },
  {
    q: "What is a recording containing several songs commonly called?",
    options: ["Album", "Single", "Note", "Score"],
    answer: 0,
    reward: 200
  },
  {
    q: "What does a cappella mean?",
    options: ["Sung without instrumental accompaniment", "Played very loudly", "Played with drums only", "Sung in a foreign language"],
    answer: 0,
    reward: 300
  },
  {
    q: "Which instrument is known for having a mouthpiece and a long metal body with keys?",
    options: ["Saxophone", "Violin", "Harp", "Tuba"],
    answer: 0,
    reward: 250
  },
  {
    q: "Which family does the flute traditionally belong to?",
    options: ["String", "Woodwind", "Brass", "Percussion"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is the highest common female singing voice?",
    options: ["Bass", "Alto", "Tenor", "Soprano"],
    answer: 3,
    reward: 250
  },
  {
    q: "What is the term for two performers singing together?",
    options: ["Solo", "Duet", "Trio", "Chorus"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which musical genre is traditionally associated with electric guitars, bass, and drums?",
    options: ["Rock", "Classical", "Opera", "Ambient"],
    answer: 0,
    reward: 200
  },


  // ============================================================
  // SPORTS — 25 QUESTIONS
  // ============================================================

  {
    q: "How many players are on the court for one basketball team at a time?",
    options: ["4", "5", "6", "7"],
    answer: 1,
    reward: 200
  },
  {
    q: "How many players are on a soccer team on the field at the start of a match?",
    options: ["9", "10", "11", "12"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which sport uses a shuttlecock?",
    options: ["Tennis", "Badminton", "Volleyball", "Table tennis"],
    answer: 1,
    reward: 200
  },
  {
    q: "How many points is a touchdown worth in American football before the extra point?",
    options: ["3", "6", "7", "10"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which sport is played at Wimbledon?",
    options: ["Golf", "Tennis", "Cricket", "Rugby"],
    answer: 1,
    reward: 200
  },
  {
    q: "How many rings are on the Olympic symbol?",
    options: ["4", "5", "6", "7"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which sport uses a puck?",
    options: ["Ice hockey", "Lacrosse", "Baseball", "Cricket"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is the maximum score with one dart in standard darts?",
    options: ["50", "60", "100", "120"],
    answer: 1,
    reward: 350
  },
  {
    q: "Which country is famous for sumo wrestling?",
    options: ["China", "Japan", "South Korea", "Mongolia"],
    answer: 1,
    reward: 200
  },
  {
    q: "How many bases are there in baseball?",
    options: ["3", "4", "5", "6"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which sport is associated with the Tour de France?",
    options: ["Cycling", "Running", "Swimming", "Motorsport"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is a score of zero called in tennis?",
    options: ["Nil", "Love", "Blank", "Duck"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which sport uses a bat, ball, and wickets?",
    options: ["Baseball", "Cricket", "Hockey", "Golf"],
    answer: 1,
    reward: 250
  },
  {
    q: "How many holes are played in a standard round of golf?",
    options: ["9", "12", "18", "24"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which sport features the pommel horse?",
    options: ["Gymnastics", "Equestrian", "Wrestling", "Fencing"],
    answer: 0,
    reward: 300
  },
  {
    q: "What color card usually means a player is sent off in soccer?",
    options: ["Blue", "Yellow", "Red", "Green"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which sport uses a net and six players per team on the court?",
    options: ["Volleyball", "Basketball", "Handball", "Badminton"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is the term for three strikes in a row in bowling?",
    options: ["Turkey", "Eagle", "Hat-trick", "Triple"],
    answer: 0,
    reward: 300
  },
  {
    q: "Which sport has positions called pitcher and catcher?",
    options: ["Cricket", "Baseball", "Rugby", "Tennis"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which sport is Michael Phelps famous for?",
    options: ["Swimming", "Cycling", "Running", "Diving"],
    answer: 0,
    reward: 200
  },
  {
    q: "Which sport is played on a court with a hoop?",
    options: ["Basketball", "Volleyball", "Tennis", "Squash"],
    answer: 0,
    reward: 150
  },
  {
    q: "What is the term for scoring three goals by one player in a soccer match?",
    options: ["Triple", "Hat-trick", "Three-peat", "Treble"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which sport uses a foil, épée, or sabre?",
    options: ["Fencing", "Archery", "Golf", "Cycling"],
    answer: 0,
    reward: 300
  },
  {
    q: "In boxing, what does KO stand for?",
    options: ["Kick Out", "Knockout", "Keep Out", "Knock Over"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which sport is played on a diamond-shaped field?",
    options: ["Baseball", "Soccer", "Tennis", "Golf"],
    answer: 0,
    reward: 250
  },


  // ============================================================
  // SPACE — 25 QUESTIONS
  // ============================================================

  {
    q: "Which planet is known as the Red Planet?",
    options: ["Venus", "Jupiter", "Mars", "Saturn"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which is the largest planet in our solar system?",
    options: ["Saturn", "Jupiter", "Neptune", "Earth"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which planet is closest to the Sun?",
    options: ["Venus", "Earth", "Mercury", "Mars"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which planet is famous for its prominent rings?",
    options: ["Mars", "Saturn", "Venus", "Mercury"],
    answer: 1,
    reward: 200
  },
  {
    q: "What is Earth's natural satellite?",
    options: ["The Sun", "The Moon", "Mars", "Venus"],
    answer: 1,
    reward: 150
  },
  {
    q: "What galaxy contains our solar system?",
    options: ["Andromeda", "Milky Way", "Whirlpool", "Sombrero"],
    answer: 1,
    reward: 200
  },
  {
    q: "What is the name of the first artificial satellite?",
    options: ["Apollo 1", "Sputnik 1", "Explorer 1", "Voyager 1"],
    answer: 1,
    reward: 400
  },
  {
    q: "Which planet is known for having a Great Red Spot?",
    options: ["Jupiter", "Mars", "Neptune", "Saturn"],
    answer: 0,
    reward: 250
  },
  {
    q: "What is a star primarily composed of?",
    options: ["Rock and ice", "Hydrogen and helium", "Iron and gold", "Oxygen and nitrogen"],
    answer: 1,
    reward: 300
  },
  {
    q: "What do we call a rock from space that reaches Earth's surface?",
    options: ["Asteroid", "Meteorite", "Comet", "Nebula"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which planet is the hottest on average?",
    options: ["Mercury", "Venus", "Mars", "Jupiter"],
    answer: 1,
    reward: 300
  },
  {
    q: "What is the name of the force that keeps objects in orbit?",
    options: ["Gravity", "Friction", "Magnetism", "Pressure"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is a large group of stars, gas, and dust held together by gravity called?",
    options: ["Galaxy", "Asteroid", "Meteor", "Crater"],
    answer: 0,
    reward: 300
  },
  {
    q: "Which planet rotates on its side?",
    options: ["Uranus", "Mars", "Venus", "Jupiter"],
    answer: 0,
    reward: 400
  },
  {
    q: "What is the name of the telescope launched in 1990 that transformed space observation?",
    options: ["Kepler", "Hubble", "Spitzer", "Chandra"],
    answer: 1,
    reward: 350
  },
  {
    q: "Which planet is farthest from the Sun among the eight planets?",
    options: ["Uranus", "Neptune", "Saturn", "Pluto"],
    answer: 1,
    reward: 250
  },
  {
    q: "What is a rapidly rotating neutron star that emits beams of radiation called?",
    options: ["Pulsar", "Quasar", "Nebula", "Comet"],
    answer: 0,
    reward: 500
  },
  {
    q: "What is the apparent path of the Sun across the sky called?",
    options: ["Ecliptic", "Equator", "Meridian", "Horizon"],
    answer: 0,
    reward: 400
  },
  {
    q: "What do we call a massive object whose gravity is so strong that light cannot escape?",
    options: ["White dwarf", "Black hole", "Pulsar", "Red giant"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which planet has the shortest year?",
    options: ["Earth", "Mercury", "Mars", "Venus"],
    answer: 1,
    reward: 400
  },
  {
    q: "What is the term for a system of millions or billions of stars?",
    options: ["Galaxy", "Planet", "Orbit", "Asteroid belt"],
    answer: 0,
    reward: 250
  },
  {
    q: "Which planet is often called Earth's sister planet because of its similar size?",
    options: ["Mars", "Venus", "Jupiter", "Mercury"],
    answer: 1,
    reward: 300
  },
  {
    q: "What is the name of the first human-made object to reach interstellar space?",
    options: ["Voyager 1", "Apollo 11", "Hubble", "Sputnik 1"],
    answer: 0,
    reward: 450
  },
  {
    q: "What is the boundary around a black hole beyond which nothing can escape?",
    options: ["Photon ring", "Event horizon", "Singularity", "Accretion disk"],
    answer: 1,
    reward: 450
  },
  {
    q: "What type of celestial object is Halley's?",
    options: ["Planet", "Comet", "Asteroid", "Galaxy"],
    answer: 1,
    reward: 250
  },


  // ============================================================
  // TECHNOLOGY — 25 QUESTIONS
  // ============================================================

  {
    q: "What does CPU stand for?",
    options: ["Central Processing Unit", "Computer Personal Unit", "Central Program Utility", "Core Processing Utility"],
    answer: 0,
    reward: 200
  },
  {
    q: "What does RAM stand for?",
    options: ["Random Access Memory", "Rapid Application Module", "Read Access Memory", "Random Application Machine"],
    answer: 0,
    reward: 200
  },
  {
    q: "What does URL stand for?",
    options: ["Universal Resource Link", "Uniform Resource Locator", "User Reference Link", "Universal Routing Location"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which company developed the Android operating system?",
    options: ["Apple", "Google", "Microsoft", "IBM"],
    answer: 1,
    reward: 200
  },
  {
    q: "What does HTML stand for?",
    options: ["HyperText Markup Language", "HighText Machine Language", "Hyperlink Text Management Language", "Home Tool Markup Language"],
    answer: 0,
    reward: 250
  },
  {
    q: "What does CSS primarily control on a website?",
    options: ["Database storage", "Visual styling", "Server hardware", "Email delivery"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which language is primarily used to style web pages?",
    options: ["JavaScript", "Python", "CSS", "SQL"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which language is commonly used to add interactivity to web pages?",
    options: ["HTML", "CSS", "JavaScript", "SQL"],
    answer: 2,
    reward: 200
  },
  {
    q: "What does SQL commonly stand for?",
    options: ["Structured Query Language", "System Query Link", "Simple Question Language", "Structured Question Logic"],
    answer: 0,
    reward: 300
  },
  {
    q: "Which company created the iPhone?",
    options: ["Samsung", "Apple", "Google", "Nokia"],
    answer: 1,
    reward: 150
  },
  {
    q: "What does USB stand for?",
    options: ["Universal Serial Bus", "United System Board", "Universal Storage Base", "User Serial Bridge"],
    answer: 0,
    reward: 250
  },
  {
    q: "What is the binary representation system based on?",
    options: ["2 digits", "8 digits", "10 digits", "16 digits"],
    answer: 0,
    reward: 250
  },
  {
    q: "Which number system uses only 0 and 1?",
    options: ["Decimal", "Binary", "Hexadecimal", "Octal"],
    answer: 1,
    reward: 150
  },
  {
    q: "What does AI stand for?",
    options: ["Automated Internet", "Artificial Intelligence", "Advanced Interface", "Algorithmic Input"],
    answer: 1,
    reward: 150
  },
  {
    q: "What does HTTP stand for?",
    options: ["HyperText Transfer Protocol", "High Transfer Text Process", "Hyperlink Transfer Program", "Host Text Transfer Protocol"],
    answer: 0,
    reward: 300
  },
  {
    q: "Which company developed Windows?",
    options: ["Apple", "Microsoft", "IBM", "Google"],
    answer: 1,
    reward: 150
  },
  {
    q: "What does PDF stand for?",
    options: ["Portable Document Format", "Personal Data File", "Program Document Format", "Portable Data Framework"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is phishing primarily designed to do?",
    options: ["Improve internet speed", "Steal information through deception", "Repair computers", "Encrypt files safely"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which storage device generally has no moving mechanical parts?",
    options: ["SSD", "Floppy disk", "Hard disk drive", "Tape drive"],
    answer: 0,
    reward: 250
  },
  {
    q: "What does GPS stand for?",
    options: ["Global Positioning System", "General Path Service", "Global Program Signal", "Geographic Position Service"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is a computer's permanent startup firmware traditionally called?",
    options: ["BIOS", "RAM", "CPU", "GPU"],
    answer: 0,
    reward: 350
  },
  {
    q: "What does GPU stand for?",
    options: ["Graphics Processing Unit", "General Processing Utility", "Graphical Program Unit", "Graphics Program Utility"],
    answer: 0,
    reward: 250
  },
  {
    q: "What is Git primarily used for?",
    options: ["Version control", "Photo editing", "Video streaming", "Database hosting"],
    answer: 0,
    reward: 250
  },
  {
    q: "What platform is commonly used to host Git repositories?",
    options: ["GitHub", "Photoshop", "Spotify", "Discord"],
    answer: 0,
    reward: 150
  },
  {
    q: "What does API stand for?",
    options: ["Application Programming Interface", "Advanced Program Internet", "Application Process Integration", "Automated Programming Input"],
    answer: 0,
    reward: 300
  },


  // ============================================================
  // GENERAL KNOWLEDGE — 25 QUESTIONS
  // ============================================================

  {
    q: "How many sides does a hexagon have?",
    options: ["5", "6", "7", "8"],
    answer: 1,
    reward: 200
  },
  {
    q: "How many days are in a leap year?",
    options: ["364", "365", "366", "367"],
    answer: 2,
    reward: 200
  },
  {
    q: "How many minutes are in one hour?",
    options: ["30", "45", "60", "90"],
    answer: 2,
    reward: 150
  },
  {
    q: "What is the largest mammal in the world?",
    options: ["African elephant", "Blue whale", "Giraffe", "Orca"],
    answer: 1,
    reward: 250
  },
  {
    q: "How many colors are traditionally listed in a rainbow?",
    options: ["5", "6", "7", "8"],
    answer: 2,
    reward: 200
  },
  {
    q: "What is the fastest land animal?",
    options: ["Lion", "Cheetah", "Horse", "Leopard"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which animal is known for having a very long neck?",
    options: ["Elephant", "Giraffe", "Zebra", "Camel"],
    answer: 1,
    reward: 150
  },
  {
    q: "How many degrees are in a full circle?",
    options: ["90", "180", "270", "360"],
    answer: 3,
    reward: 200
  },
  {
    q: "What is the square root of 64?",
    options: ["6", "7", "8", "9"],
    answer: 2,
    reward: 200
  },
  {
    q: "What is 12 × 12?",
    options: ["124", "134", "144", "154"],
    answer: 2,
    reward: 200
  },
  {
    q: "How many letters are in the English alphabet?",
    options: ["24", "25", "26", "27"],
    answer: 2,
    reward: 150
  },
  {
    q: "Which month comes after September?",
    options: ["August", "October", "November", "December"],
    answer: 1,
    reward: 150
  },
  {
    q: "What is the primary language spoken in Brazil?",
    options: ["Spanish", "Portuguese", "French", "English"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which animal is commonly called man's best friend?",
    options: ["Cat", "Horse", "Dog", "Parrot"],
    answer: 2,
    reward: 150
  },
  {
    q: "What is the currency of Japan?",
    options: ["Won", "Yuan", "Yen", "Ringgit"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which metal is liquid at room temperature?",
    options: ["Iron", "Mercury", "Copper", "Aluminum"],
    answer: 1,
    reward: 300
  },
  {
    q: "How many planets are officially recognized in our solar system?",
    options: ["7", "8", "9", "10"],
    answer: 1,
    reward: 200
  },
  {
    q: "What is the opposite of 'ancient'?",
    options: ["Old", "Modern", "Historic", "Antique"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which shape has three sides?",
    options: ["Square", "Triangle", "Pentagon", "Hexagon"],
    answer: 1,
    reward: 150
  },
  {
    q: "What is the freezing point of water in Celsius?",
    options: ["0°C", "10°C", "32°C", "100°C"],
    answer: 0,
    reward: 150
  },
  {
    q: "Which sense organ is primarily responsible for hearing?",
    options: ["Eye", "Ear", "Nose", "Tongue"],
    answer: 1,
    reward: 150
  },
  {
    q: "What is the largest land animal?",
    options: ["Giraffe", "African elephant", "Hippopotamus", "Rhino"],
    answer: 1,
    reward: 200
  },
  {
    q: "How many sides does a pentagon have?",
    options: ["4", "5", "6", "7"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which direction does the Sun generally rise from?",
    options: ["North", "South", "East", "West"],
    answer: 2,
    reward: 200
  },
  {
    q: "What is the chemical symbol for gold?",
    options: ["Gd", "Go", "Au", "Ag"],
    answer: 2,
    reward: 300
  },


  // ============================================================
  // NATURE & ANIMALS — 25 QUESTIONS
  // ============================================================

  {
    q: "Which animal is known as the largest land mammal?",
    options: ["Rhino", "African elephant", "Giraffe", "Hippopotamus"],
    answer: 1,
    reward: 200
  },
  {
    q: "What do pandas primarily eat?",
    options: ["Bamboo", "Fish", "Grass", "Fruit"],
    answer: 0,
    reward: 200
  },
  {
    q: "Which bird is commonly associated with being unable to fly?",
    options: ["Eagle", "Penguin", "Falcon", "Swallow"],
    answer: 1,
    reward: 150
  },
  {
    q: "What is a baby frog called?",
    options: ["Cub", "Tadpole", "Calf", "Chick"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which animal is famous for changing its color for camouflage?",
    options: ["Chameleon", "Elephant", "Horse", "Penguin"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is the largest species of shark?",
    options: ["Great white shark", "Hammerhead shark", "Whale shark", "Tiger shark"],
    answer: 2,
    reward: 300
  },
  {
    q: "Which mammal is capable of true sustained flight?",
    options: ["Flying squirrel", "Bat", "Sugar glider", "Colugo"],
    answer: 1,
    reward: 300
  },
  {
    q: "What do bees collect from flowers to make honey?",
    options: ["Nectar", "Leaves", "Seeds", "Bark"],
    answer: 0,
    reward: 200
  },
  {
    q: "Which animal is known for its black-and-white stripes?",
    options: ["Zebra", "Tiger", "Panda", "Skunk"],
    answer: 0,
    reward: 150
  },
  {
    q: "What is the largest living reptile?",
    options: ["Komodo dragon", "Green anaconda", "Saltwater crocodile", "Leatherback turtle"],
    answer: 2,
    reward: 400
  },
  {
    q: "Which animal is known for producing pearls?",
    options: ["Oyster", "Clam", "Jellyfish", "Starfish"],
    answer: 0,
    reward: 250
  },
  {
    q: "What is a group of lions called?",
    options: ["Pack", "Pride", "Herd", "Flock"],
    answer: 1,
    reward: 200
  },
  {
    q: "Which animal has a trunk?",
    options: ["Rhino", "Elephant", "Tapir", "Walrus"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which animal is famous for building dams?",
    options: ["Otter", "Beaver", "Badger", "Mole"],
    answer: 1,
    reward: 200
  },
  {
    q: "What type of animal is a Komodo dragon?",
    options: ["Mammal", "Bird", "Reptile", "Amphibian"],
    answer: 2,
    reward: 200
  },
  {
    q: "Which animal has the longest gestation period among land mammals?",
    options: ["Elephant", "Giraffe", "Rhino", "Gorilla"],
    answer: 0,
    reward: 450
  },
  {
    q: "Which animal is known for echolocation?",
    options: ["Bat", "Elephant", "Giraffe", "Kangaroo"],
    answer: 0,
    reward: 250
  },
  {
    q: "What is the largest species of penguin?",
    options: ["King penguin", "Emperor penguin", "Gentoo penguin", "Macaroni penguin"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which animal is commonly associated with eucalyptus leaves?",
    options: ["Koala", "Panda", "Sloth", "Lemur"],
    answer: 0,
    reward: 200
  },
  {
    q: "What is the fastest bird in a dive?",
    options: ["Eagle", "Peregrine falcon", "Ostrich", "Albatross"],
    answer: 1,
    reward: 400
  },
  {
    q: "Which animal is famous for its ability to regenerate lost limbs?",
    options: ["Axolotl", "Horse", "Lion", "Penguin"],
    answer: 0,
    reward: 400
  },
  {
    q: "What is a group of wolves commonly called?",
    options: ["Pride", "Pack", "Herd", "Colony"],
    answer: 1,
    reward: 150
  },
  {
    q: "Which insect is known for producing silk?",
    options: ["Ant", "Silkworm", "Bee", "Dragonfly"],
    answer: 1,
    reward: 250
  },
  {
    q: "Which animal is famous for its black-and-white coloration and strong bite?",
    options: ["Panda", "Orca", "Skunk", "Badger"],
    answer: 1,
    reward: 300
  },
  {
    q: "Which mammal lays eggs?",
    options: ["Dolphin", "Platypus", "Kangaroo", "Sloth"],
    answer: 1,
    reward: 400
  }

];

module.exports = TRIVIA_QUESTIONS;
