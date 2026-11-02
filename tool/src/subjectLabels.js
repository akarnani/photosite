// Subjects `photosite subjects` can name. Each photo gets the label whose
// prompts best match it (CLIP zero-shot; a label's prompts are averaged). Add
// a label here to get a new group; labels that match only a couple of photos
// fold into the most similar group.
const uw = (s) => [`an underwater photo of ${s}`, `a close-up underwater photo of ${s}`, `a scuba diving photo of ${s}`];
const L = (name, ...subjects) => ({ name, prompts: subjects.flatMap(uw) });
const A = (name, ...prompts) => ({ name, prompts });

export const SUBJECT_LABELS = [
  // Underwater: fish
  L('Clownfish', 'a clownfish', 'an orange anemonefish in a sea anemone'),
  L('Frogfish', 'a frogfish', 'a lumpy camouflaged anglerfish'),
  L('Scorpionfish', 'a scorpionfish', 'a stonefish camouflaged on the reef'),
  L('Lionfish', 'a lionfish with long striped spines'),
  L('Seahorse', 'a seahorse', 'a pygmy seahorse'),
  L('Pipefish', 'a pipefish', 'a ghost pipefish'),
  L('Moray eel', 'a moray eel', 'an eel poking out of a hole'),
  L('Blenny or goby', 'a small blenny', 'a goby fish', 'a tiny fish peeking out of a hole'),
  L('Pufferfish', 'a pufferfish', 'a boxfish'),
  L('Mandarinfish', 'a mandarinfish', 'a psychedelic dragonet'),
  L('Reef fish', 'a colorful reef fish', 'an angelfish', 'a butterflyfish', 'a parrotfish'),
  L('School of fish', 'a large school of fish', 'a shoal of fish in blue water'),
  L('Shark', 'a shark'),
  L('Manta or ray', 'a manta ray', 'a stingray', 'an eagle ray'),
  // Underwater: everything else
  L('Sea turtle', 'a sea turtle'),
  L('Nudibranch', 'a nudibranch', 'a colorful sea slug', 'a flatworm'),
  L('Octopus or squid', 'an octopus', 'a squid', 'a cuttlefish'),
  L('Shrimp or crab', 'a shrimp', 'a crab', 'a lobster'),
  L('Coral and reef', 'a coral reef', 'hard coral'),
  L('Sea fan and soft coral', 'a sea fan', 'soft coral', 'a sponge'),
  L('Diver', 'a scuba diver'),
  L('Wreck', 'a shipwreck'),
  A('Dolphin or whale', 'a photo of a dolphin', 'a photo of a whale'),
  // Above water
  A('Bird', 'a photo of a bird', 'a wildlife photo of a bird'),
  A('Mammal', 'a wildlife photo of a mammal', 'a photo of a wild animal'),
  A('Reptile', 'a photo of a lizard', 'a photo of a snake', 'a photo of a crocodile'),
  A('Fighter jet', 'a photo of a fighter jet in flight', 'a photo of a military jet'),
  A('Propeller plane', 'a photo of a propeller airplane in flight', 'a photo of a vintage warbird'),
  A('Formation flying', 'a photo of airplanes flying in formation', 'a photo of an aerobatic team with smoke trails'),
  A('Helicopter', 'a photo of a helicopter'),
  A('Aircraft on the ground', 'a photo of an airplane parked on the ground', 'a photo of an airshow crowd and parked aircraft'),
  A('Landscape', 'a photo of a beach', 'a photo of a tropical island', 'a photo of a sunset over the ocean'),
  A('Boat', 'a photo of a boat', 'a photo of a dive boat'),
  A('People', 'a photo of people', 'a portrait of a person'),
];
