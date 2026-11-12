/**
 * TEST-ONLY Town Hall rules for the synthetic sample catalogue. Values are
 * invented and do not describe the real game. Never import from app code.
 */

const hallSteps = Array.from({ length: 8 }, (_, index) => ({
  townHall: index + 1,
  maxLevel: index + 1,
  maxQuantity: 1
}))

export const SAMPLE_TOWN_HALL_RULES = {
  maxTownHall: { 'home-village': 8, 'builder-base': 3 },
  items: [
    { itemId: 'test-hall', steps: hallSteps, unlockRequires: [] },
    {
      itemId: 'test-gold-mine',
      steps: [
        { townHall: 1, maxLevel: 2, maxQuantity: 1 },
        { townHall: 2, maxLevel: 4, maxQuantity: 2 },
        { townHall: 4, maxLevel: 6, maxQuantity: 4 }
      ],
      unlockRequires: []
    },
    {
      itemId: 'test-cannon',
      steps: [
        { townHall: 1, maxLevel: 2, maxQuantity: 2 },
        { townHall: 3, maxLevel: 4, maxQuantity: 2 },
        { townHall: 5, maxLevel: 6, maxQuantity: 3 }
      ],
      unlockRequires: []
    },
    {
      itemId: 'test-mortar',
      steps: [
        { townHall: 3, maxLevel: 1, maxQuantity: 1 },
        { townHall: 5, maxLevel: 3, maxQuantity: 2 }
      ],
      unlockRequires: []
    },
    {
      itemId: 'test-spike-trap',
      steps: [{ townHall: 4, maxLevel: 2, maxQuantity: 4 }],
      unlockRequires: []
    },
    {
      itemId: 'test-knight',
      steps: [
        { townHall: 7, maxLevel: 5, maxQuantity: 1 },
        { townHall: 8, maxLevel: 10, maxQuantity: 1 }
      ],
      unlockRequires: [{ itemId: 'test-hall', level: 7 }]
    },
    {
      itemId: 'test-archer',
      steps: [
        { townHall: 1, maxLevel: 1, maxQuantity: 1 },
        { townHall: 3, maxLevel: 2, maxQuantity: 1 },
        { townHall: 5, maxLevel: 3, maxQuantity: 1 }
      ],
      unlockRequires: []
    },
    {
      itemId: 'test-heal-spell',
      steps: [{ townHall: 6, maxLevel: 2, maxQuantity: 1 }],
      unlockRequires: []
    },
    {
      itemId: 'test-decoration',
      steps: [{ townHall: 1, maxLevel: 1, maxQuantity: 1 }],
      unlockRequires: []
    },
    {
      itemId: 'bb-test-cannon',
      steps: [
        { townHall: 1, maxLevel: 2, maxQuantity: 1 },
        { townHall: 3, maxLevel: 4, maxQuantity: 2 }
      ],
      unlockRequires: []
    }
  ]
}
