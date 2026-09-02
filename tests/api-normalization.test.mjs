import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeUploadPhotoResponse,
  normalizeWorkEntries,
} from "../app/tracker/api.ts";

const photoUrl = "https://drive.google.com/file/d/photo-id/view";

test("loads photo URLs from the Google Sheets Photo Links column", () => {
  const entries = normalizeWorkEntries(
    {
      workEntries: [
        {
          "Entry ID": "entry-1",
          Date: "2026-09-01",
          "Employee ID": "employee-1",
          "Property ID": "property-1",
          Hours: 8,
          "Work Performed": "Test entry",
          "Photo Links": JSON.stringify([photoUrl]),
        },
      ],
    },
    [],
    [],
  );

  assert.deepEqual(entries[0]?.photos, [photoUrl]);
});

test("loads the Drive URL from nested photo-upload responses", () => {
  assert.equal(
    normalizeUploadPhotoResponse({ success: true, result: { driveLink: photoUrl } }),
    photoUrl,
  );
});
