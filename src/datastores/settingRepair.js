// Match and update in one datastore operation so repairs cannot replace a
// selection written after the repair read its original value.
export async function updateSettingIfUnchanged(datastore, key, expectedValue, value) {
  const { numAffected } = await datastore.updateAsync(
    { _id: key, value: expectedValue },
    { $set: { value } }
  )
  return numAffected === 1
}
