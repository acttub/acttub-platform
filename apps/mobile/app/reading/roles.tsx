import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { countLinesByRole } from '@/lib/reading/parse';
import { getCurrent, updateCurrent } from '@/lib/reading/store';

export default function ReadingRoles() {
  const router = useRouter();
  const script = getCurrent();
  const [selected, setSelected] = useState<string[]>(script?.myRoles ?? []);

  const roles = useMemo(() => {
    if (!script) return [] as { role: string; count: number }[];
    const counts = countLinesByRole(script.lines);
    return script.roles
      .map((role) => ({ role, count: counts.get(role) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [script]);

  if (!script) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.empty}>대본이 없어요. 먼저 대본을 넣어주세요.</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading/new')}>
          <Text style={styles.pillText}>대본 넣기로</Text>
        </Pressable>
      </View>
    );
  }

  const toggle = (role: string) =>
    setSelected((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  const onStart = async () => {
    if (selected.length < 1) return;
    await updateCurrent({ myRoles: selected, status: 'reading' });
    router.replace('/reading/play');
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.step}>STEP 2 · 배역 선택</Text>
        <Text style={styles.title}>연습할 배역을 선택해주세요</Text>
        <Text style={styles.sub}>내가 연기할 배역을 고르면, 나머지 배역은 앱이 소리로 읽어줘요.</Text>

        <View style={styles.scriptCard}>
          <View style={styles.scriptIcon}>
            <Feather name="file-text" size={16} color={palette.blue} />
          </View>
          <View>
            <Text style={styles.scriptTitle}>{script.title}</Text>
            <Text style={styles.scriptMeta}>배역 {roles.length}명 · 대사 {script.dialogueCount}개</Text>
          </View>
        </View>

        <View style={styles.list}>
          {roles.map(({ role, count }) => {
            const on = selected.includes(role);
            return (
              <Pressable key={role} style={[styles.roleRow, on && styles.roleRowOn]} onPress={() => toggle(role)}>
                <View style={styles.roleInfo}>
                  <Text style={[styles.roleName, on && styles.roleNameOn]}>{role}</Text>
                  <Text style={styles.roleDesc}>{on ? '내가 연습할 배역' : `대사 ${count}개 · 자동 음성`}</Text>
                </View>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on ? <Feather name="check" size={14} color="#fff" /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.primary, selected.length < 1 && styles.primaryOff]} onPress={onStart} disabled={selected.length < 1}>
          <Text style={styles.primaryText}>
            {selected.length < 1 ? '배역을 선택하세요' : `선택한 ${selected.length}개 배역으로 연습하기`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  empty: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15 },
  content: { padding: 20, gap: 10 },
  step: { color: palette.blue, fontFamily: 'Pretendard-SemiBold', fontSize: 12, letterSpacing: 0.3 },
  title: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 2 },
  sub: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 20, marginBottom: 4 },
  scriptCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 12, padding: 14 },
  scriptIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  scriptTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  scriptMeta: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  list: { gap: 10, marginTop: 6 },
  roleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 16 },
  roleRowOn: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  roleInfo: { gap: 3 },
  roleName: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 16 },
  roleNameOn: { color: palette.blueDeep },
  roleDesc: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13 },
  check: { width: 24, height: 24, borderRadius: 12, borderColor: palette.checkOff, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  footer: { padding: 16, borderTopColor: palette.borderSoft, borderTopWidth: 1, backgroundColor: palette.bg },
  primary: { backgroundColor: palette.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryOff: { backgroundColor: palette.checkOff },
  primaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
