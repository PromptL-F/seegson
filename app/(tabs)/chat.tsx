import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SeegsonLogo } from "@/components/seegson-logo";
import { startOAuthLogin } from "@/constants/oauth";
import { useAuth } from "@/hooks/use-auth";
import { applyAgentActions, buildChatContext } from "@/lib/agent-executor";
import { clearChat, loadChat, saveChat, type StoredChatMessage } from "@/lib/seegson-storage";
import { colors, radii } from "@/lib/seegson-theme";
import { trpc } from "@/lib/trpc";

const SUGGESTIONS = [
  "Recuérdame mañana a las 9:00 llamar al banco",
  "Todos los lunes a las 8:00 revisar la agenda",
  "¿Qué tengo pendiente?",
];

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ChatScreen() {
  const { loading: authLoading, isAuthenticated } = useAuth();
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const chat = trpc.agent.chat.useMutation();
  const memoriesQuery = trpc.agent.memories.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const forgetMemory = trpc.agent.forgetMemory.useMutation();
  const memories = (memoriesQuery.data ?? []).slice(0, 3);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadChat().then((saved) => {
        if (active) setMessages(saved);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const push = useCallback((current: StoredChatMessage[], extra: StoredChatMessage[]) => {
    const next = [...current, ...extra];
    setMessages(next);
    void saveChat(next);
    return next;
  }, []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    setDraft("");
    setSending(true);

    const withUser = push(messages, [{ id: makeId(), role: "user", content }]);
    try {
      // La IA solo recibe los turnos de conversación; los avisos del sistema no cuentan.
      let history = withUser
        .filter((message): message is StoredChatMessage & { role: "user" | "assistant" } => message.role !== "notice")
        .slice(-20)
        .map((message) => ({ role: message.role, content: message.content }));
      while (history.length > 0 && history[0].role !== "user") history = history.slice(1);

      const context = await buildChatContext();
      const result = await chat.mutateAsync({ messages: history, context });
      const outcomes = result.actions.length > 0 ? await applyAgentActions(result.actions) : [];

      if (result.remembered) void memoriesQuery.refetch();
      push(withUser, [
        { id: makeId(), role: "assistant", content: result.reply },
        ...(result.remembered
          ? [{ id: makeId(), role: "notice" as const, content: `✓ Guardado en memoria: ${result.remembered}` }]
          : []),
        ...outcomes.map((outcome) => ({
          id: makeId(),
          role: "notice" as const,
          content: `${outcome.ok ? "✓" : "⚠"} ${outcome.message}`,
        })),
      ]);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "No se pudo contactar con el agente.";
      push(withUser, [{ id: makeId(), role: "notice", content: `⚠ ${message}` }]);
    } finally {
      setSending(false);
    }
  };

  const confirmClear = () => {
    const wipe = async () => {
      await clearChat();
      setMessages([]);
    };
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm("¿Borrar la conversación? Tus recordatorios no se eliminan.")) void wipe();
      return;
    }
    Alert.alert("Borrar conversación", "Tus recordatorios y eventos no se eliminan.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Borrar", style: "destructive", onPress: () => void wipe() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <SeegsonLogo size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.brandName}>SEEGSON</Text>
          <Text style={styles.brandSubtitle}>AGENTE CON IA</Text>
        </View>
        {messages.length > 0 && (
          <Pressable onPress={confirmClear} style={styles.headerButton} accessibilityLabel="Borrar conversación">
            <Ionicons name="trash-outline" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>

      {!isAuthenticated && !authLoading ? (
        <View style={styles.gate}>
          <View style={styles.gateCard}>
            <Ionicons name="lock-closed-outline" size={22} color={colors.amber} />
            <Text style={styles.gateTitle}>Inicia sesión para hablar con el agente</Text>
            <Text style={styles.gateBody}>
              El agente usa una IA en la nube, así que necesita tu cuenta para protegerla de usos ajenos. Tus recordatorios se siguen guardando en este teléfono.
            </Text>
            <Pressable onPress={() => void startOAuthLogin()} style={styles.gateButton}>
              <Text style={styles.gateButtonText}>Continuar con Manus</Text>
              <Ionicons name="arrow-forward" size={15} color={colors.background} />
            </Pressable>
          </View>
        </View>
      ) : authLoading ? (
        <View style={styles.gate}><ActivityIndicator color={colors.teal} /></View>
      ) : (
        // "padding" funciona en Android (con edge-to-edge) y en iOS; la barra de pestañas se oculta con el teclado.
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 ? (
              <View style={styles.intro}>
                <Text style={styles.eyebrow}>TU AGENTE PERSONAL</Text>
                <Text style={styles.title}>Dile qué recordar.{"\n"}<Text style={{ color: colors.teal }}>Él se acuerda.</Text></Text>
                <Text style={styles.introText}>
                  Escribe como hablas: “recuérdame el viernes a las 6 pagar la luz”. El agente crea el aviso en tu teléfono y puede consultar lo que ya tienes agendado.
                </Text>
                <View style={styles.chips}>
                  {SUGGESTIONS.map((suggestion) => (
                    <Pressable key={suggestion} style={styles.chip} onPress={() => void send(suggestion)}>
                      <Text style={styles.chipText}>{suggestion}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              messages.map((message) =>
                message.role === "notice" ? (
                  <View key={message.id} style={[styles.notice, message.content.startsWith("⚠") && styles.noticeWarn]}>
                    <Text style={[styles.noticeText, message.content.startsWith("⚠") && { color: colors.red }]}>{message.content}</Text>
                  </View>
                ) : (
                  <View key={message.id} style={[styles.bubble, message.role === "user" ? styles.bubbleUser : styles.bubbleAgent]}>
                    <Text style={[styles.bubbleText, message.role === "user" && { color: colors.background }]}>{message.content}</Text>
                  </View>
                ),
              )
            )}
            {sending && (
              <View style={[styles.bubble, styles.bubbleAgent, styles.typing]}>
                <ActivityIndicator size="small" color={colors.teal} />
                <Text style={styles.typingText}>Pensando…</Text>
              </View>
            )}
          </ScrollView>

          {memories.length > 0 && (
            <View style={styles.memoryBox}>
              <Text style={styles.memoryLabel}>MEMORIA</Text>
              {memories.map((memory) => (
                <View key={memory.id} style={styles.memoryRow}>
                  <Ionicons name="bookmark-outline" size={12} color={colors.amber} />
                  <Text style={styles.memoryText} numberOfLines={2}>{memory.content}</Text>
                  <Pressable
                    onPress={() => void forgetMemory.mutateAsync({ id: memory.id }).then(() => memoriesQuery.refetch())}
                    hitSlop={8}
                    accessibilityLabel="Olvidar este recuerdo"
                  >
                    <Ionicons name="close" size={14} color={colors.dim} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Escribe un recordatorio o una pregunta…"
              placeholderTextColor={colors.dim}
              style={styles.composerInput}
              multiline
              maxLength={600}
              editable={!sending}
              onSubmitEditing={() => void send(draft)}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={() => void send(draft)}
              disabled={sending || !draft.trim()}
              style={[styles.sendButton, (sending || !draft.trim()) && { opacity: 0.4 }]}
              accessibilityLabel="Enviar"
            >
              <Ionicons name="arrow-up" size={20} color={colors.background} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  brandName: { color: colors.text, fontSize: 13, fontWeight: "900", letterSpacing: 2.3 },
  brandSubtitle: { color: colors.dim, fontSize: 8, fontWeight: "700", letterSpacing: 1.4, marginTop: 3 },
  headerButton: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  messages: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 9, maxWidth: 640, width: "100%", alignSelf: "center" },
  intro: { marginTop: 18 },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: "900", letterSpacing: 1.8, marginBottom: 8 },
  title: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.5 },
  introText: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 10 },
  chips: { gap: 8, marginTop: 20 },
  chip: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11 },
  chipText: { color: colors.text, fontSize: 12 },
  bubble: { maxWidth: "86%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: colors.amber, borderBottomRightRadius: 5 },
  bubbleAgent: { alignSelf: "flex-start", backgroundColor: colors.surfaceRaised, borderBottomLeftRadius: 5 },
  bubbleText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  typing: { flexDirection: "row", alignItems: "center", gap: 8 },
  typingText: { color: colors.muted, fontSize: 12 },
  notice: { alignSelf: "flex-start", backgroundColor: colors.tealSoft, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8, maxWidth: "92%" },
  noticeWarn: { backgroundColor: colors.redSoft },
  noticeText: { color: "#A5C6C1", fontSize: 11, lineHeight: 16 },
  memoryBox: { paddingHorizontal: 20, paddingVertical: 8, gap: 5, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  memoryLabel: { color: colors.dim, fontSize: 8, fontWeight: "900", letterSpacing: 1.5 },
  memoryRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  memoryText: { flex: 1, color: colors.muted, fontSize: 10, lineHeight: 14 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 9, paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === "web" ? 12 : 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  composerInput: { flex: 1, minHeight: 44, maxHeight: 120, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.input + 4, color: colors.text, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 13 },
  sendButton: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center" },
  gate: { flex: 1, justifyContent: "center", padding: 20 },
  gateCard: { backgroundColor: colors.surface, borderRadius: 19, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 8, alignItems: "flex-start" },
  gateTitle: { color: colors.text, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  gateBody: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  gateButton: { marginTop: 8, flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: colors.amber, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  gateButtonText: { color: colors.background, fontSize: 12, fontWeight: "900" },
});
