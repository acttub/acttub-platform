import AsyncStorage from '@react-native-async-storage/async-storage';

import { createPendingAnalysisStore } from '@/lib/pending-analysis';

export const pendingAnalysisStore = createPendingAnalysisStore(AsyncStorage);
