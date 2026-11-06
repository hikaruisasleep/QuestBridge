package xyz.jxcb.ftbquestoverlay;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
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

    // The constructor for the mod class is the first code that is run when your mod is loaded.
    // FML will recognize some parameter types like IEventBus or ModContainer and pass them in automatically.
    public QuestBridge(IEventBus modEventBus, ModContainer modContainer) {
        modContainer.registerConfig(ModConfig.Type.CLIENT, QuestBridgeConfig.SPEC);
        this.client = new QuestBridgeClient();
        LOGGER.info("[QuestBridge] client adapter initialized ({})", MODID);
    }
}
