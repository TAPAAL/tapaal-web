import dk.aau.cs.io.*;
import dk.aau.cs.model.tapn.*;
import java.io.File;
import java.math.BigDecimal;
import dk.aau.cs.model.tapn.simulation.OldestFiringMode;
import java.util.*;
import net.tapaal.gui.petrinet.Template;

/** Released scalar classes and loader/writer; no application tab or engine substitution. */
public class ConstantsReference {
  static void weight(String kind, Weight w) {
    System.out.println("WEIGHT " + kind + " " + w.getClass().getSimpleName() + " " + w.nameForSaving(true) + " " + w.value());
  }
  static void bound(String kind, Bound b) {
    System.out.println("BOUND " + kind + " " + b.getClass().getSimpleName() + " " + b + " " + b.value());
  }
  static void observe(LoadedModel model) {
    for (Constant c : model.network().constants()) System.out.println("CONSTANT " + c.name() + " " + c.value());
    for (Template template : model.templates()) {
      TimedArcPetriNet net = template.model();
      for (TimedPlace p : net.places()) bound("invariant", p.invariant().upperBound());
      for (TimedInputArc a : net.inputArcs()) { weight("input",a.getWeight()); bound("lower",a.interval().lowerBound()); bound("upper",a.interval().upperBound()); }
      for (TimedOutputArc a : net.outputArcs()) weight("output",a.getWeight());
      for (TimedInhibitorArc a : net.inhibitorArcs()) weight("inhibitor",a.getWeight());
      for (TransportArc a : net.transportArcs()) { weight("transport",a.getWeight()); bound("transport-lower",a.interval().lowerBound()); bound("transport-upper",a.interval().upperBound()); }
      for (TimedTransition t : net.transitions()) System.out.println("ENABLED " + t.name() + " " + t.isEnabled());
    }
  }
  static void execute(LoadedModel model) {
    TimedArcPetriNetNetwork network = model.network();
    NetworkMarking original = network.marking();
    try {
      boolean delay = original.isDelayPossible(new BigDecimal("2"));
      if (delay) network.setMarking(original.delay(new BigDecimal("2")));
      for (Template template : model.templates()) {
        TimedTransition transition = template.model().getTransitionByName("o");
        if (transition == null) continue;
        boolean enabled = transition.isEnabled();
        System.out.println("EXEC delay2 " + delay + " o " + enabled);
        if (enabled) network.setMarking(network.marking().fireTransition(transition, new OldestFiringMode()).value1());
        System.out.println("EXEC marking p=" + template.model().getPlaceByName("p").numberOfTokens()
            + " q=" + template.model().getPlaceByName("q").numberOfTokens());
      }
    } finally { network.setMarking(original); }
  }
  static void save(LoadedModel model, String path) throws Exception {
    new TimedArcPetriNetNetworkWriter(model.network(),model.templates(),model.queries(),model.network().constants(),model.getLens()).savePNML(new File(path));
  }
  public static void main(String[] args) {
    try {
      LoadedModel model = new TapnXmlLoader().load(new File(args[0]));
      if (model == null) throw new IllegalStateException("Loader returned null");
      System.out.println("BEFORE"); observe(model);
      if (args.length > 2) execute(model);
      save(model,args[1]);
      if (args.length > 2) {
        for (Constant c : model.network().constants()) if (c.name().equals("K")) c.setValue(4);
        System.out.println("AFTER"); observe(model); execute(model);
        save(model,args[2]);
      }
    } catch (Throwable error) { System.out.println("REFUSED " + error.getClass().getSimpleName() + " " + error.getMessage()); }
    System.exit(0);
  }
}
