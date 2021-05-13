## 0.6.5
* Update to Starboard notebook 0.9.3 which requires a `clear()` method for cell handlers.

## 0.6.4
* Throw errors correctly instead of shielding them.

## 0.6.3
**Date:** 2021-05-02

* Matplotlib figures will again render as expected.
* There is now a global lock on Python execution to prevent weird interwoven cell executions happening when importing libraries.
