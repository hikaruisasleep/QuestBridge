package xyz.jxcb.ftbquestoverlay;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.fml.event.config.ModConfigEvent;
import org.slf4j.Logger;

import com.mojang.logging.LogUtils;

import xyz.jxcb.ftbquestoverlay.client.QuestBridgeClient;

// The value here should match an entry in the META-INF/neoforge.mods.toml file
@Mod(value = QuestBridge.MODID, dist = Dist.CLIENT)
public class QuestBridge {
    // Define mod id in a common place for everything to reference
    public static final String MODID = "questbridge";
    // Directly reference a slf4j logger
    public static final Logger LOGGER = LogUtils.getLogger();

    private final QuestBridgeClient client;

    /**
     * The mod constructor.
     *
     * <p><b>Ordering matters here, and getting it wrong is a recorded defect.</b>
     * {@code registerConfig} only *schedules* the config to be loaded; it does not
     * load it. The client is therefore constructed without starting its transport,
     * and starts it from {@link ModConfigEvent.Loading} instead.</p>
     *
     * <p>The original code constructed the client, which immediately read
     * {@code minecraftToken} from a spec that was not loaded yet, saw an empty
     * string, and concluded there was no token — permanently. The client log
     * showed the read sixteen seconds before NeoForge loaded the file, so the
     * documented configuration path could not work at all on {@code 0pre.2}
     * ({@code docs/troubleshooting.md} section 2.1).</p>
     */
    public QuestBridge(IEventBus modEventBus, ModContainer modContainer) {
        modContainer.registerConfig(ModConfig.Type.CLIENT, QuestBridgeConfig.SPEC);

        // Construct without transport. The capture loop observes FTB
        // independently, so it is safe to start before the config is readable.
        this.client = new QuestBridgeClient();

        // Start transport once the config spec is readable. Both events are
        // registered: Loading fires on first load, Reloading when the file
        // changes or a manual config reload runs, and either can be the first one
        // seen depending on load order.
        modEventBus.addListener(ModConfigEvent.Loading.class, this::onConfigLoaded);
        modEventBus.addListener(ModConfigEvent.Reloading.class, this::onConfigLoaded);

        LOGGER.info("[QuestBridge] client adapter initialized ({}); "
                + "waiting for the config load before starting transport", MODID);
    }

    /**
     * Starts the transport once the client config is readable.
     *
     * <p>Idempotent, because both events can fire: a reload must not start a
     * second transport, which would present two publishers to a host that accepts
     * one and would be refused with HTTP 409.</p>
     */
    private void onConfigLoaded(ModConfigEvent event) {
        if (event.getConfig().getSpec() != QuestBridgeConfig.SPEC) {
            // Another mod's config, or another type. Not ours to act on.
            return;
        }
        client.startTransportOnce("config loaded");
    }
}
