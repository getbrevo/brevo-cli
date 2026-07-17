/**
 * When a contact's isfav attribute changes, outputs a flag to signal downstream steps to create the contact in one subaccount and delete from another.
 *
 * @formula
 * isfav_changed = true for every contact whose ISFAV attribute changed, DEFAULT true
 *
 * @explanation
 * This function reads the isfav attribute from each contact that triggered an update event.
 * It checks both the live-test and production data shapes to find the current isfav value.
 * The output signals downstream automation steps to create the contact in one subaccount and delete it from another.
 * Every contact that passes through this function receives the flag so the downstream actions can proceed.
 */
async function handleIsFavChange(objects, context) {
  try {
    // Normalize: production sends ONE contact, the tester sends an array
    const list = Array.isArray(objects) ? objects : [objects];
    const output = [];

    for (const obj of list) {
      // Read contact_id defensively
      const contactId = String(obj.contact_id || obj.id);

      // Read organization_id from the object first, fall back to context
      const orgId = String(obj.organization_id || context.organizationId);

      // Read attributes from both input shapes:
      // Live test data: obj.attributes.ISFAV
      // Production topic: obj.current_contact_data.attributes.ISFAV
      const ccd = obj.current_contact_data || {};
      const attributes = ccd.attributes || obj.attributes || {};

      // Extract the isfav value, checking both casings
      const isFav = attributes.ISFAV !== undefined ? attributes.ISFAV : (attributes.isfav !== undefined ? attributes.isfav : false);

      // Build flat output object with exactly one computed field:
      // isfav_changed is set to true to signal downstream steps
      // Downstream step 1: create this contact in the target subaccount
      // Downstream step 2: delete this contact from the other subaccount
      output.push({
        organization_id: orgId,
        contact_id: contactId,
        isfav_changed: true
      });
    }

    return output;
  } catch (error) {
    console.error('handleIsFavChange failed: ' + error.message);
    return [{ __error: error.message }];
  }
}