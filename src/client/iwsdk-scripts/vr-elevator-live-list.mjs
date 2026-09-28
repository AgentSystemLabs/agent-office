import assert from 'node:assert/strict';

// Run in an active immersive session with at least one floor. Visit the rooftop first to
// cover both cabs. The synthetic floor list is client-only and is always restored.
export default async function run({ frame }) {
  const result = await frame.evaluate(() => {
    const { store, office, roof, vr } = window.__office;
    if (!vr.active) throw new Error('An immersive session is required');
    const original = store.floors;
    if (!original.length) throw new Error('At least one floor is required');
    const cabs = [office.elevator, roof()?.elevator].filter(Boolean);
    const ids = () =>
      cabs.map((cab) =>
        cab.group
          .getObjectByName('elevator-floor-buttons')
          .children.filter((key) => key.userData.interact)
          .map((key) => key.userData.interact.floorId),
      );
    try {
      const added = { ...original[0], id: 'test-added', name: 'Fresh floor', cloning: true };
      store.apply({ t: 'floors', floors: [...original, added] });
      const cloning = { ids: ids(), press: cabs.map((cab) => cab.pressFloor(added.id)) };
      store.apply({ t: 'floors', floors: [...original, { ...added, cloning: false, name: 'Renamed floor' }] });
      const ready = { ids: ids(), press: cabs.map((cab) => cab.pressFloor(added.id)) };
      store.apply({ t: 'floors', floors: original });
      return { cloning, ready, removed: ids(), stalePress: cabs.map((cab) => cab.pressFloor(added.id)) };
    } finally {
      store.apply({ t: 'floors', floors: original });
    }
  });
  assert.ok(result.cloning.ids.every((ids) => ids.includes('test-added')));
  assert.ok(result.cloning.press.every((pressed) => !pressed));
  assert.ok(result.ready.press.every(Boolean));
  assert.ok(result.removed.every((ids) => !ids.includes('test-added')));
  assert.ok(result.stalePress.every((pressed) => !pressed));
  return result;
}
