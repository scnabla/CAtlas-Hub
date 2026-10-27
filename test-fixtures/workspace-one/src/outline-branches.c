#if MODE == 1
void first_path(void) {}
#elif MODE == 2
void second_path(void) {}
#ifdef NESTED
void nested_path(void) {}
#else
void nested_fallback(void) {}
#endif
#else
void fallback_path(void) {}
#endif
