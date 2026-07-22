import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { Text } from "../i18n";
import type { PendingChangelog } from "../services/changelog";
import { IOSPopupModal } from "./IOSPopupModal";

export function ChangelogModal({
  changelog,
  onClose,
  visible,
}: {
  changelog?: PendingChangelog;
  onClose: () => void;
  visible: boolean;
}) {
  if (!changelog) return null;

  return (
    <IOSPopupModal onRequestClose={onClose} visible={visible}>
      <View style={styles.card}>
        <View style={styles.mark}>
          <Text style={styles.markText}>墨</Text>
        </View>
        <Text style={styles.eyebrow}>{changelog.firstOpen ? "FIRST OPEN" : "WHAT'S NEW"}</Text>
        <Text style={styles.title}>{changelog.firstOpen ? "初见，幸会" : "新墨已干"}</Text>
        <Text style={styles.version}>墨读 v{changelog.version}</Text>

        <ScrollView
          contentContainerStyle={styles.entries}
          showsVerticalScrollIndicator={false}
          style={styles.scroller}
        >
          {changelog.entries.map((entry, index) => (
            <View key={`${entry.title}-${index}`} style={styles.entry}>
              <View style={styles.entryIcon}>
                <Ionicons color="#4F6C5D" name="sparkles-outline" size={17} />
              </View>
              <View style={styles.entryCopy}>
                <Text style={styles.entryTitle}>{entry.title}</Text>
                <Text style={styles.entryDetail}>{entry.detail}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        <Pressable onPress={onClose} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>继续阅读</Text>
          <Ionicons color="#FFF8EB" name="arrow-forward" size={17} />
        </Pressable>
      </View>
    </IOSPopupModal>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    backgroundColor: "#FCFAF5",
    borderRadius: 28,
    maxHeight: "82%",
    maxWidth: 480,
    padding: 24,
    width: "100%",
  },
  mark: {
    alignItems: "center",
    backgroundColor: "#315D4B",
    borderRadius: 19,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  markText: { color: "#F3DFC0", fontFamily: "serif", fontSize: 25, fontWeight: "900" },
  eyebrow: { color: "#789083", fontSize: 8, fontWeight: "900", letterSpacing: 2, marginTop: 14 },
  title: { color: "#303630", fontFamily: "serif", fontSize: 24, fontWeight: "900", marginTop: 5 },
  version: { color: "#718076", fontSize: 10.5, fontWeight: "700", marginTop: 5 },
  scroller: { alignSelf: "stretch", marginTop: 16, maxHeight: 285 },
  entries: { gap: 9 },
  entry: {
    alignItems: "flex-start",
    backgroundColor: "#F3F1EA",
    borderRadius: 17,
    flexDirection: "row",
    padding: 13,
  },
  entryIcon: {
    alignItems: "center",
    backgroundColor: "#E3ECE6",
    borderRadius: 12,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  entryCopy: { flex: 1, marginLeft: 11, minWidth: 0 },
  entryTitle: { color: "#3B433E", fontSize: 12.5, fontWeight: "900" },
  entryDetail: { color: "#85837D", fontSize: 10.5, lineHeight: 17, marginTop: 3 },
  button: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#315D4B",
    borderRadius: 15,
    flexDirection: "row",
    gap: 8,
    height: 48,
    justifyContent: "center",
    marginTop: 18,
  },
  buttonText: { color: "#FFF8EB", fontSize: 12.5, fontWeight: "900" },
  pressed: { transform: [{ scale: 0.98 }] },
});
