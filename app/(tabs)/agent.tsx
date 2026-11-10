import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/hooks/use-auth";
import { startOAuthLogin } from "@/constants/oauth";
import {
  cancelLocalNotification,
  ensureNotificationPermission,
  isValidTime,
  scheduleDailyReminder,
} from "@/lib/notifications";
import {
  loadDailyTasks,
  saveDailyTasks,
  type DailyReminderTask,
} from "@/lib/seegson-storage";
import { colors, radii } from "@/lib/seegson-theme";
import { trpc } from "@/lib/trpc";

type TaskMode = "daily" | "arch_news";
type RemoteArchTask = {
  id: number;
  title: string;
  kind: "arch_news";
  localTime: string;
  timeZone: string;
  isEnabled: boolean;
  lastCheckedAt: Date | string | null;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatLastChecked(value: Date | string | null): string {
  if (!value) return "Aún no comprobado";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Aún no comprobado";
  return `Última revisión ${date.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`;
}

export default function AgentScreen() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [dailyTasks, setDailyTasks] = useState<DailyReminderTask[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingDaily, setEditingDaily] = useState<DailyReminderTask | null>(null);
  const [editingRemote, setEditingRemote] = useState<RemoteArchTask | null>(null);
  const [taskMode, setTaskMode] = useState<TaskMode>("daily");
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("09:00");
  const [enabled, setEnabled] = useState(true);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pushNotice, setPushNotice] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const utils = trpc.useUtils();
  const tasksQuery = trpc.agent.tasks.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const createMonitor = trpc.agent.createArchMonitor.useMutation();
  const updateMonitor = trpc.agent.updateArchMonitor.useMutation();
  const deleteMonitor = trpc.agent.deleteArchMonitor.useMutation();
  const registerPushToken = trpc.agent.registerPushToken.useMutation();
  const memoriesQuery = trpc.agent.memories.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const chatAgent = trpc.agent.chat.useMutation();
  const forgetMemory = trpc.agent.forgetMemory.useMutation();
  const registerPushTokenAsync = registerPushToken.mutateAsync;
  const pushRegistrationFor = useRef<string | null>(null);

  const remoteTasks = useMemo(
    () => (tasksQuery.data ?? []) as unknown as RemoteArchTask[],
    [tasksQuery.data],
  );

  const sendChatMessage = async () => {
    const message = chatInput.trim();
    if (!message || chatAgent.isPending || !isAuthenticated) return;
    setChatInput("");
    setChatMessages((current) => [...current, { role: "user", content: message }]);
    try {
      const response = await chatAgent.mutateAsync({ message });
      setChatMessages((current) => [...current, { role: "assistant", content: response.reply }]);
      await memoriesQuery.refetch();
    } catch {
      setChatMessages((current) => [...current, { role: "assistant", content: "No pude conectarme con la IA. Comprueba la conexión e inténtalo de nuevo." }]);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadDailyTasks().then(async (saved) => {
        if (!active) return;
        const normalized: DailyReminderTask[] = [];
        let restorationFailed = false;
        for (const task of saved) {
          if (task.enabled && !task.notificationId) {
            const notificationId = await scheduleDailyReminder({ taskId: task.id, title: task.title, time: task.time });
            if (!notificationId) {
              restorationFailed = true;
              normalized.push({ ...task, enabled: false, notificationId: undefined });
            } else {
              normalized.push({ ...task, notificationId });
            }
          } else {
            normalized.push(task);
          }
        }
        if (active) {
          setDailyTasks(normalized);
          if (restorationFailed) setPushNotice("Una rutina quedó pausada porque Android no pudo restaurar su notificación. Revisa los permisos.");
          if (normalized.some((task, index) => task.notificationId !== saved[index]?.notificationId || task.enabled !== saved[index]?.enabled)) {
            await saveDailyTasks(normalized);
          }
        }
      }).catch(() => {
        if (active) setPushNotice("No se pudieron cargar los recordatorios de este dispositivo.");
      });
      return () => {
        active = false;
      };
    }, []),
  );

  useEffect(() => {
    let active = true;
    const registerPush = async () => {
      if (!isAuthenticated || !user?.openId || Platform.OS !== "android") {
        if (!isAuthenticated) pushRegistrationFor.current = null;
        return;
      }
      if (pushRegistrationFor.current === user.openId) return;
      pushRegistrationFor.current = user.openId;
      const easProjectId = Constants.easConfig?.projectId ?? (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
      if (!easProjectId) {
        if (active) setPushNotice("Los avisos de Arch quedarán en tu bandeja. Conecta Expo y genera un build Android para habilitar notificaciones remotas con la app cerrada.");
        return;
      }
      try {
        const permitted = await ensureNotificationPermission();
        if (!permitted) {
          if (active) setPushNotice("Activa las notificaciones de Seegson en Android para recibir avisos de Arch.");
          return;
        }
        const token = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId });
        await registerPushTokenAsync({ token: token.data });
        if (active) setPushNotice("Este dispositivo está listo para recibir avisos del agente.");
      } catch {
        if (active) setPushNotice("No se pudo registrar el envío remoto. Las alertas seguirán disponibles en la bandeja de Seegson.");
      }
    };
    void registerPush();
    return () => {
      active = false;
    };
  }, [isAuthenticated, user?.openId, registerPushTokenAsync]);

  const openNewTask = () => {
    setEditingDaily(null);
    setEditingRemote(null);
    setTaskMode("daily");
    setTitle("");
    setTime("09:00");
    setEnabled(true);
    setFormError("");
    setModalVisible(true);
  };

  const openEditDaily = (task: DailyReminderTask) => {
    setEditingDaily(task);
    setEditingRemote(null);
    setTaskMode("daily");
    setTitle(task.title);
    setTime(task.time);
    setEnabled(task.enabled);
    setFormError("");
    setModalVisible(true);
  };

  const openEditRemote = (task: RemoteArchTask) => {
    setEditingDaily(null);
    setEditingRemote(task);
    setTaskMode("arch_news");
    setTitle(task.title);
    setTime(task.localTime);
    setEnabled(task.isEnabled);
    setFormError("");
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setFormError("");
  };

  const saveTask = async () => {
    setFormError("");
    if (!isValidTime(time)) return setFormError("Escribe la hora en formato HH:MM.");
    if (taskMode === "daily" && !title.trim()) return setFormError("Escribe qué quieres recordar cada día.");
    if (taskMode === "arch_news" && !isAuthenticated) return setFormError("Inicia sesión para que el agente pueda ejecutar esta tarea en el servidor.");

    setSaving(true);
    try {
      if (taskMode === "daily") {
        const nextTask: DailyReminderTask = {
          id: editingDaily?.id ?? makeId(),
          title: title.trim(),
          time,
          enabled,
          notificationId: undefined,
        };
        if (editingDaily?.notificationId) await cancelLocalNotification(editingDaily.notificationId);
        if (enabled) {
          nextTask.notificationId = (await scheduleDailyReminder({
            taskId: nextTask.id,
            title: nextTask.title,
            time: nextTask.time,
          })) ?? undefined;
        }
        const schedulingFailed = enabled && !nextTask.notificationId;
        if (schedulingFailed) {
          nextTask.enabled = false;
          setEnabled(false);
        }
        const next = editingDaily
          ? dailyTasks.map((task) => task.id === editingDaily.id ? nextTask : task)
          : [...dailyTasks, nextTask];
        await saveDailyTasks(next);
        setDailyTasks(next);
        if (schedulingFailed) {
          setFormError("La tarea se guardó pausada porque no se pudo programar. Comprueba los permisos de notificación.");
          return;
        }
      } else if (editingRemote) {
        await updateMonitor.mutateAsync({
          id: editingRemote.id,
          enabled,
          time,
          timeZone: editingRemote.timeZone || getDeviceTimeZone(),
        });
        await utils.agent.tasks.invalidate();
      } else {
        if (!isAuthenticated) return setFormError("Inicia sesión para activar la vigilancia de Arch.");
        await createMonitor.mutateAsync({ time, timeZone: getDeviceTimeZone() });
        await utils.agent.tasks.invalidate();
      }
      closeModal();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo guardar la tarea.");
    } finally {
      setSaving(false);
    }
  };

  const toggleDailyTask = async (task: DailyReminderTask) => {
    setPushNotice("");
    try {
      const nextEnabled = !task.enabled;
      const nextTask: DailyReminderTask = { ...task, enabled: nextEnabled, notificationId: undefined };
      if (task.notificationId) await cancelLocalNotification(task.notificationId);
      if (nextEnabled) {
        nextTask.notificationId = (await scheduleDailyReminder({ taskId: task.id, title: task.title, time: task.time })) ?? undefined;
      }
      if (nextEnabled && !nextTask.notificationId) {
        nextTask.enabled = false;
        setPushNotice("La rutina quedó pausada porque Android no pudo programar la notificación. Revisa sus permisos.");
      }
      const next = dailyTasks.map((item) => item.id === task.id ? nextTask : item);
      await saveDailyTasks(next);
      setDailyTasks(next);
    } catch {
      setPushNotice("No se pudo cambiar el recordatorio. Inténtalo de nuevo.");
    }
  };

  const removeDailyTask = async (task: DailyReminderTask) => {
    setPushNotice("");
    try {
      await cancelLocalNotification(task.notificationId);
      const next = dailyTasks.filter((item) => item.id !== task.id);
      await saveDailyTasks(next);
      setDailyTasks(next);
    } catch {
      setPushNotice("No se pudo eliminar el recordatorio diario.");
    }
  };

  const toggleRemoteTask = async (task: RemoteArchTask) => {
    setPushNotice("");
    try {
      await updateMonitor.mutateAsync({ id: task.id, enabled: !task.isEnabled });
      await utils.agent.tasks.invalidate();
    } catch {
      setPushNotice("No se pudo cambiar la vigilancia. Revisa la conexión e inténtalo de nuevo.");
      await utils.agent.tasks.invalidate();
    }
  };

  const removeRemoteTask = async (task: RemoteArchTask) => {
    setPushNotice("");
    try {
      await deleteMonitor.mutateAsync({ id: task.id });
      await utils.agent.tasks.invalidate();
    } catch {
      setPushNotice("No se pudo eliminar la vigilancia. Inténtalo de nuevo.");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Image source={require("@/assets/images/icon.png")} style={styles.brandLogo} accessibilityLabel="Logo Seegson" /></View>
          <View><Text style={styles.brandName}>SEEGSON</Text><Text style={styles.brandSubtitle}>AGENTE PERSONAL</Text></View>
          <Pressable style={styles.addIconButton} onPress={openNewTask} accessibilityLabel="Crear tarea">
            <Ionicons name="add" size={21} color={colors.background} />
          </Pressable>
        </View>

        <View style={styles.introBlock}>
          <Text style={styles.eyebrow}>TAREAS PROGRAMADAS</Text>
          <Text style={styles.pageTitle}>Deja el seguimiento{"\n"}<Text style={styles.pageTitleAccent}>en buenas manos.</Text></Text>
          <Text style={styles.introText}>Crea un aviso diario o encarga al agente que vigile una fuente por ti.</Text>
        </View>

        <View style={styles.chatCard}>
          <View style={styles.chatHeader}>
            <View style={styles.chatIcon}><Ionicons name="sparkles" size={17} color={colors.background} /></View>
            <View style={{ flex: 1 }}><Text style={styles.chatTitle}>Habla con Seegson</Text><Text style={styles.chatSubtitle}>IA remota · memoria persistente</Text></View>
            <View style={styles.onlineDot} />
          </View>
          {!isAuthenticated ? (
            <Text style={styles.chatHint}>Inicia sesión para conversar con el agente y conservar recuerdos entre dispositivos.</Text>
          ) : (
            <>
              {chatMessages.length === 0 && <Text style={styles.chatHint}>Prueba: “Recuerda que mi revisión semanal es los viernes”</Text>}
              {chatMessages.slice(-4).map((message, index) => <View key={`${message.role}-${index}`} style={[styles.chatBubble, message.role === "user" ? styles.chatBubbleUser : styles.chatBubbleAgent]}><Text style={styles.chatBubbleText}>{message.content}</Text></View>)}
              <View style={styles.chatComposer}>
                <TextInput value={chatInput} onChangeText={setChatInput} onSubmitEditing={() => void sendChatMessage()} placeholder="Escribe a tu agente…" placeholderTextColor={colors.dim} style={styles.chatInput} multiline maxLength={4000} returnKeyType="send" />
                <Pressable onPress={() => void sendChatMessage()} disabled={chatAgent.isPending || !chatInput.trim()} style={[styles.chatSend, (chatAgent.isPending || !chatInput.trim()) && { opacity: 0.45 }]} accessibilityLabel="Enviar mensaje"><Ionicons name={chatAgent.isPending ? "hourglass-outline" : "arrow-up"} size={17} color={colors.background} /></Pressable>
              </View>
            </>
          )}
          {isAuthenticated && memoriesQuery.data && memoriesQuery.data.length > 0 && <View style={styles.memoryStrip}><Ionicons name="bookmark-outline" size={13} color={colors.amber} /><Text style={styles.memoryText} numberOfLines={2}>Recuerda: {memoriesQuery.data[0].content}</Text><Pressable onPress={() => void forgetMemory.mutateAsync({ id: memoriesQuery.data[0].id }).then(() => memoriesQuery.refetch())} accessibilityLabel="Olvidar último recuerdo"><Ionicons name="close" size={14} color={colors.dim} /></Pressable></View>}
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoIcon}><Ionicons name="sparkles-outline" size={18} color={colors.teal} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Dos formas de actuar</Text>
            <Text style={styles.infoBody}>Los recordatorios se programan en este Android. Arch se revisa a diario en el servidor y avisa solo ante una noticia nueva; la ejecución continua requiere publicar la app y conectar Expo para habilitar push al Android.</Text>
          </View>
        </View>

        <View style={styles.sectionHeading}>
          <View><Text style={styles.sectionEyebrow}>EN ESTE DISPOSITIVO</Text><Text style={styles.sectionTitle}>Recordatorios diarios</Text></View>
          <Text style={styles.countText}>{dailyTasks.length}</Text>
        </View>
        {dailyTasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="sunny-outline" size={22} color={colors.amber} />
            <Text style={styles.emptyTitle}>Una rutina, a su hora</Text>
            <Text style={styles.emptyBody}>Por ejemplo: “Revisar la agenda” todos los días a las 9:00.</Text>
          </View>
        ) : (
          <View style={styles.taskList}>
            {dailyTasks.map((task) => (
              <View key={task.id} style={styles.taskCard}>
                <View style={styles.taskIconDaily}><Ionicons name="repeat-outline" size={18} color={colors.amber} /></View>
                <View style={styles.taskMain}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  <Text style={styles.taskMeta}>Cada día · {task.time}</Text>
                </View>
                <Switch value={task.enabled} onValueChange={() => void toggleDailyTask(task)} trackColor={{ false: colors.surfaceSoft, true: colors.amberSoft }} thumbColor={task.enabled ? colors.amber : colors.muted} />
                <Pressable onPress={() => openEditDaily(task)} style={styles.smallIconButton} accessibilityLabel="Editar recordatorio"><Ionicons name="create-outline" size={17} color={colors.muted} /></Pressable>
                <Pressable onPress={() => void removeDailyTask(task)} style={styles.smallIconButton} accessibilityLabel="Eliminar recordatorio"><Ionicons name="trash-outline" size={16} color={colors.dim} /></Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={[styles.sectionHeading, { marginTop: 25 }]}>
          <View><Text style={styles.sectionEyebrow}>VIGILANCIA EXTERNA</Text><Text style={styles.sectionTitle}>Novedades de Arch</Text></View>
          <View style={styles.secureBadge}><View style={styles.secureDot} /><Text style={styles.secureText}>FEED OFICIAL</Text></View>
        </View>
        {!isAuthenticated && !authLoading ? (
          <View style={styles.signInCard}>
            <View style={styles.signInIcon}><Ionicons name="lock-closed-outline" size={20} color={colors.amber} /></View>
            <Text style={styles.signInTitle}>Vincula tu cuenta para activar al agente</Text>
            <Text style={styles.signInBody}>La vigilancia programada se guarda de forma segura y puede ejecutarse aunque Seegson no esté abierta.</Text>
            <Pressable onPress={() => void startOAuthLogin()} style={styles.signInButton}>
              <Text style={styles.signInButtonText}>Continuar con Manus</Text><Ionicons name="arrow-forward" size={15} color={colors.background} />
            </Pressable>
          </View>
        ) : authLoading ? (
          <View style={styles.loadingCard}><ActivityIndicator color={colors.teal} /><Text style={styles.loadingText}>Preparando el agente…</Text></View>
        ) : tasksQuery.isLoading ? (
          <View style={styles.loadingCard}><ActivityIndicator color={colors.teal} /><Text style={styles.loadingText}>Cargando tareas…</Text></View>
        ) : tasksQuery.isError ? (
          <View style={styles.loadingCard}><Text style={styles.loadingText}>No se pudo cargar la vigilancia.</Text><Pressable onPress={() => void tasksQuery.refetch()}><Text style={{ color: colors.teal, fontSize: 11, fontWeight: "800" }}>Reintentar</Text></Pressable></View>
        ) : remoteTasks.length === 0 ? (
          <Pressable style={styles.monitorCard} onPress={() => { setTaskMode("arch_news"); setEditingDaily(null); setEditingRemote(null); setTitle("Novedades oficiales de Arch Linux"); setTime("09:00"); setEnabled(true); setFormError(""); setModalVisible(true); }}>
            <View style={styles.monitorIcon}><Ionicons name="logo-tux" size={20} color={colors.teal} /></View>
            <View style={styles.monitorMain}>
              <Text style={styles.monitorTitle}>Arch Linux News</Text>
              <Text style={styles.monitorBody}>Revisa el feed oficial una vez al día y avisa cuando aparezca una entrada nueva.</Text>
              <View style={styles.sourceLine}><Ionicons name="link-outline" size={12} color={colors.teal} /><Text style={styles.sourceText}>archlinux.org/feeds/news/</Text></View>
            </View>
            <Ionicons name="add-circle-outline" size={22} color={colors.amber} />
          </Pressable>
        ) : (
          <View style={styles.taskList}>
            {remoteTasks.map((task) => (
              <View key={task.id} style={styles.taskCard}>
                <View style={styles.taskIconArch}><Ionicons name="logo-tux" size={18} color={colors.teal} /></View>
                <View style={styles.taskMain}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  <Text style={styles.taskMeta}>Cada día · {task.localTime} · {formatLastChecked(task.lastCheckedAt)}</Text>
                  <Text style={styles.taskSubMeta}>archlinux.org/feeds/news/</Text>
                </View>
                <Switch value={task.isEnabled} onValueChange={() => void toggleRemoteTask(task)} trackColor={{ false: colors.surfaceSoft, true: colors.tealSoft }} thumbColor={task.isEnabled ? colors.teal : colors.muted} />
                <Pressable onPress={() => openEditRemote(task)} style={styles.smallIconButton} accessibilityLabel="Editar vigilancia"><Ionicons name="create-outline" size={17} color={colors.muted} /></Pressable>
                <Pressable onPress={() => void removeRemoteTask(task)} style={styles.smallIconButton} accessibilityLabel="Eliminar vigilancia"><Ionicons name="trash-outline" size={16} color={colors.dim} /></Pressable>
              </View>
            ))}
          </View>
        )}

        {!!pushNotice && isAuthenticated && <View style={styles.pushNotice}><Ionicons name="information-circle-outline" size={16} color={colors.amber} /><Text style={styles.pushNoticeText}>{pushNotice}</Text></View>}
        {isAuthenticated && (
          <View style={styles.userLine}>
            <View style={styles.userAvatar}><Ionicons name="person-outline" size={15} color={colors.teal} /></View>
            <Text style={styles.userText}>Agente de {user?.name || "tu cuenta"}</Text>
            {tasksQuery.error && <Text style={styles.errorText}>No se pudo sincronizar</Text>}
          </View>
        )}
        <View style={{ height: 26 }} />
      </ScrollView>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <Pressable style={styles.modalBackdrop} onPress={closeModal} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View><Text style={styles.sectionEyebrow}>CONFIGURAR TAREA</Text><Text style={styles.modalTitle}>{editingDaily || editingRemote ? "Ajustar tarea" : "Nueva tarea"}</Text></View>
              <Pressable onPress={closeModal} style={styles.modalClose}><Ionicons name="close" size={20} color={colors.muted} /></Pressable>
            </View>
            {!editingDaily && !editingRemote && (
              <View style={styles.modeSelector}>
                <Pressable onPress={() => setTaskMode("daily")} style={[styles.modeOption, taskMode === "daily" && styles.modeOptionActive]}>
                  <Ionicons name="repeat-outline" size={16} color={taskMode === "daily" ? colors.amber : colors.dim} /><Text style={[styles.modeText, taskMode === "daily" && styles.modeTextActive]}>Aviso diario</Text>
                </Pressable>
                <Pressable onPress={() => setTaskMode("arch_news")} style={[styles.modeOption, taskMode === "arch_news" && styles.modeOptionActive]}>
                  <Ionicons name="radio-outline" size={16} color={taskMode === "arch_news" ? colors.teal : colors.dim} /><Text style={[styles.modeText, taskMode === "arch_news" && styles.modeTextActive]}>Vigilar Arch</Text>
                </Pressable>
              </View>
            )}
            <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" nestedScrollEnabled automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
              {taskMode === "daily" ? (
                <>
                  <Text style={styles.fieldLabel}>¿QUÉ QUIERES QUE TE RECUERDE?</Text>
                  <TextInput value={title} onChangeText={setTitle} placeholder="Ej.: Revisar la agenda" placeholderTextColor={colors.dim} style={styles.input} maxLength={120} />
                </>
              ) : (
                <View style={styles.archDescription}>
                  <View style={styles.monitorIcon}><Ionicons name="logo-tux" size={19} color={colors.teal} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.archDescriptionTitle}>Novedades oficiales de Arch Linux</Text><Text style={styles.archDescriptionText}>El agente consulta el feed de noticias una vez al día. Solo crea un aviso si detecta una entrada nueva.</Text></View>
                </View>
              )}
              <Text style={styles.fieldLabel}>HORA DIARIA · HORA LOCAL DE TU ANDROID</Text>
              <TextInput value={time} onChangeText={setTime} placeholder="09:00" placeholderTextColor={colors.dim} style={styles.input} keyboardType="numbers-and-punctuation" maxLength={5} />
              {taskMode === "arch_news" && <Text style={styles.helperText}>La comprobación se ejecutará en segundo plano en la zona horaria {editingRemote?.timeZone || getDeviceTimeZone()}.</Text>}
              {(editingDaily || editingRemote) && (
                <View style={styles.enableRow}>
                  <View style={{ flex: 1 }}><Text style={styles.enableTitle}>Tarea activa</Text><Text style={styles.enableSubtitle}>{enabled ? "Recibirás avisos según la programación" : "La tarea está pausada"}</Text></View>
                  <Switch value={enabled} onValueChange={setEnabled} trackColor={{ false: colors.surfaceSoft, true: colors.tealSoft }} thumbColor={enabled ? colors.teal : colors.muted} />
                </View>
              )}
              {!!formError && <Text style={styles.formError}>{formError}</Text>}
              {taskMode === "arch_news" && !isAuthenticated && <Text style={styles.formError}>Se requiere iniciar sesión para guardar una tarea del agente.</Text>}
              <Pressable onPress={() => void saveTask()} disabled={saving} style={[styles.saveButton, saving && { opacity: 0.65 }]}>
                <Text style={styles.saveButtonText}>{saving ? "Guardando…" : editingDaily || editingRemote ? "Guardar cambios" : "Activar tarea"}</Text>
                {!saving && <Ionicons name="arrow-forward" size={17} color={colors.background} />}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, maxWidth: 640, width: "100%", alignSelf: "center" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  brandMark: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  brandLogo: { width: 29, height: 29, borderRadius: 8 },
  brandName: { color: colors.text, fontSize: 13, fontWeight: "900", letterSpacing: 2.3 },
  brandSubtitle: { color: colors.dim, fontSize: 8, fontWeight: "700", letterSpacing: 1.4, marginTop: 3 },
  addIconButton: { marginLeft: "auto", width: 39, height: 39, borderRadius: 13, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center" },
  introBlock: { marginTop: 28, marginBottom: 19 },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: "900", letterSpacing: 1.8, marginBottom: 8 },
  pageTitle: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.5 },
  pageTitleAccent: { color: colors.teal },
  introText: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 9, maxWidth: 310 },
  chatCard: { backgroundColor: colors.surface, borderRadius: 19, borderWidth: 1, borderColor: colors.border, padding: 13, marginBottom: 16 },
  chatHeader: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 10 },
  chatIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center" },
  chatTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  chatSubtitle: { color: colors.dim, fontSize: 9, marginTop: 2 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.teal },
  chatHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginBottom: 9 },
  chatBubble: { borderRadius: 13, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 7, maxWidth: "92%" },
  chatBubbleUser: { alignSelf: "flex-end", backgroundColor: colors.tealSoft },
  chatBubbleAgent: { alignSelf: "flex-start", backgroundColor: colors.surfaceRaised },
  chatBubbleText: { color: colors.text, fontSize: 10, lineHeight: 15 },
  chatComposer: { flexDirection: "row", alignItems: "flex-end", gap: 7, marginTop: 3 },
  chatInput: { flex: 1, minHeight: 40, maxHeight: 90, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingHorizontal: 11, paddingVertical: 9, fontSize: 11 },
  chatSend: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.amber, alignItems: "center", justifyContent: "center" },
  memoryStrip: { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 11, paddingTop: 9 },
  memoryText: { color: colors.muted, fontSize: 9, lineHeight: 13, flex: 1 },
  infoCard: { flexDirection: "row", gap: 11, backgroundColor: colors.tealSoft, borderRadius: 17, borderWidth: 1, borderColor: "#28524C", padding: 13 },
  infoIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: "#214844", alignItems: "center", justifyContent: "center" },
  infoTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  infoBody: { color: "#A5C6C1", fontSize: 10, lineHeight: 15, marginTop: 4 },
  sectionHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 23, marginBottom: 12 },
  sectionEyebrow: { color: colors.dim, fontSize: 9, fontWeight: "900", letterSpacing: 1.6, marginBottom: 5 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  countText: { color: colors.amber, fontSize: 12, fontWeight: "900", backgroundColor: colors.amberSoft, borderRadius: radii.pill, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5 },
  emptyCard: { alignItems: "center", backgroundColor: colors.surface, borderRadius: 17, borderWidth: 1, borderColor: colors.border, padding: 20 },
  emptyTitle: { color: colors.text, fontSize: 13, fontWeight: "800", marginTop: 9 },
  emptyBody: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center", maxWidth: 260, marginTop: 5 },
  taskList: { gap: 9 },
  taskCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 17, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, paddingVertical: 12, gap: 7 },
  taskIconDaily: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.amberSoft, alignItems: "center", justifyContent: "center" },
  taskIconArch: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" },
  taskMain: { flex: 1, minWidth: 0, marginLeft: 2 },
  taskTitle: { color: colors.text, fontSize: 11, fontWeight: "800" },
  taskMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  taskSubMeta: { color: colors.teal, fontSize: 8, marginTop: 3 },
  smallIconButton: { width: 25, height: 32, alignItems: "center", justifyContent: "center" },
  secureBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.tealSoft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5 },
  secureDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.teal },
  secureText: { color: colors.teal, fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  signInCard: { backgroundColor: colors.surface, borderRadius: 19, borderWidth: 1, borderColor: colors.border, padding: 17, alignItems: "flex-start" },
  signInIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.amberSoft, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  signInTitle: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: "800" },
  signInBody: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  signInButton: { marginTop: 13, flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: colors.amber, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 },
  signInButtonText: { color: colors.background, fontSize: 11, fontWeight: "900" },
  loadingCard: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, backgroundColor: colors.surface, borderRadius: 16, padding: 22 },
  loadingText: { color: colors.muted, fontSize: 11 },
  monitorCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 14 },
  monitorIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" },
  monitorMain: { flex: 1 },
  monitorTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  monitorBody: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  sourceLine: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 7 },
  sourceText: { color: colors.teal, fontSize: 9, fontWeight: "700" },
  pushNotice: { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: colors.amberSoft, borderRadius: 12, padding: 10, marginTop: 13 },
  pushNoticeText: { flex: 1, color: "#D9C7A4", fontSize: 9, lineHeight: 14 },
  userLine: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 15 },
  userAvatar: { width: 24, height: 24, borderRadius: 8, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" },
  userText: { color: colors.dim, fontSize: 9, flex: 1 },
  errorText: { color: colors.red, fontSize: 9 },
  modalRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.54)" },
  modalBackdrop: { ...StyleSheet.absoluteFill },
  modalSheet: { maxHeight: "92%", backgroundColor: colors.background, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Platform.OS === "web" ? 22 : 18 },
  modalHandle: { width: 40, height: 4, borderRadius: 4, backgroundColor: colors.dim, alignSelf: "center", marginBottom: 17 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 17 },
  modalTitle: { color: colors.text, fontSize: 21, fontWeight: "800" },
  modalClose: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  modeSelector: { flexDirection: "row", gap: 8, marginBottom: 12 },
  modeOption: { flex: 1, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center", paddingVertical: 11, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  modeOptionActive: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
  modeText: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  modeTextActive: { color: colors.teal },
  formContent: { gap: 8, paddingBottom: 12 },
  fieldLabel: { color: colors.dim, fontSize: 9, fontWeight: "900", letterSpacing: 1.4, marginTop: 11, marginBottom: 1 },
  input: { minHeight: 47, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.input, color: colors.text, paddingHorizontal: 13, fontSize: 13 },
  archDescription: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.tealSoft, borderRadius: 15, borderWidth: 1, borderColor: "#28524C", padding: 12 },
  archDescriptionTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  archDescriptionText: { color: "#A5C6C1", fontSize: 10, lineHeight: 15, marginTop: 4 },
  helperText: { color: colors.dim, fontSize: 10, lineHeight: 15, marginTop: -3 },
  enableRow: { flexDirection: "row", alignItems: "center", marginTop: 9, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  enableTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  enableSubtitle: { color: colors.muted, fontSize: 10, marginTop: 3 },
  formError: { color: colors.red, fontSize: 10, lineHeight: 15, marginTop: 5 },
  saveButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 49, borderRadius: 15, backgroundColor: colors.amber, marginTop: 12 },
  saveButtonText: { color: colors.background, fontSize: 12, fontWeight: "900" },
});
